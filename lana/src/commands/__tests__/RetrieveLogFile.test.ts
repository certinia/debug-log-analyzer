/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { commands, window } from 'vscode';
import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { QuickPick } from '../../display/QuickPick.js';
import { QuickPickWorkspace } from '../../display/QuickPickWorkspace.js';
import { getLogBody, listLogs, writeFile } from '../../services/salesforceServices.js';
import { LogView } from '../LogView.js';
import { RetrieveLogFile } from '../RetrieveLogFile.js';

jest.mock('../../display/QuickPickWorkspace.js', () => ({
  QuickPickWorkspace: { pickOrReturn: jest.fn() },
}));
jest.mock('../../display/QuickPick.js', () => ({
  QuickPick: { pick: jest.fn() },
  Item: class {
    name: string;
    desc: string;
    details: string;
    sticky: boolean;
    selected: boolean;

    constructor(name: string, desc: string, details: string, sticky: boolean, selected: boolean) {
      this.name = name;
      this.desc = desc;
      this.details = details;
      this.sticky = sticky;
      this.selected = selected;
    }
  },
  Options: class {
    placeholder: string;

    constructor(placeholder: string) {
      this.placeholder = placeholder;
    }
  },
}));
jest.mock('../../services/salesforceServices.js', () => ({
  getLogBody: jest.fn(),
  listLogs: jest.fn(),
  writeFile: jest.fn(),
}));
jest.mock('../LogView.js', () => ({ LogView: { createView: jest.fn() } }));

const mockPickWorkspace = QuickPickWorkspace.pickOrReturn as jest.Mock;
const mockPick = QuickPick.pick as jest.Mock;
const mockListLogs = listLogs as jest.Mock;
const mockGetLogBody = getLogBody as jest.Mock;
const mockWriteFile = writeFile as jest.Mock;
const mockCreateView = LogView.createView as jest.Mock;
const mockRegisterCommand = commands.registerCommand as jest.Mock;

const log = (id: string, startTime = '2024-01-01T00:00:00.000Z', durationMilliseconds = 100) => ({
  Id: id,
  LogUser: { Name: 'User' },
  Operation: 'Op',
  LogLength: 1024,
  DurationMilliseconds: durationMilliseconds,
  StartTime: startTime,
  Status: 'Success',
});

describe('RetrieveLogFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPickWorkspace.mockResolvedValue('/test/workspace');
    mockListLogs.mockResolvedValue([]);
    mockPick.mockResolvedValue([]);
    mockGetLogBody.mockResolvedValue('log body');
    mockWriteFile.mockResolvedValue(undefined);
    (window.createQuickPick as jest.Mock).mockReturnValue({
      busy: false,
      enabled: true,
      placeholder: '',
      show: jest.fn(),
      dispose: jest.fn(),
    });
  });

  const command = (): (() => Promise<unknown>) =>
    mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1]?.[1];

  it('registers the command', () => {
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    expect(context.context.subscriptions).toHaveLength(1);
  });

  it('lists logs through Salesforce Services', async () => {
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();
    expect(mockListLogs).toHaveBeenCalledWith();
  });

  it('retrieves the selected body and opens it without requiring a local file', async () => {
    mockListLogs.mockResolvedValue([log('selected-log')]);
    mockPick.mockResolvedValue([{ logId: 'selected-log' }]);
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();

    expect(mockGetLogBody).toHaveBeenCalledWith('selected-log');
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('selected-log.log'),
      'log body',
    );
    expect(mockCreateView).toHaveBeenCalledWith(
      context,
      undefined,
      expect.stringContaining('selected-log.log'),
      'log body',
    );
  });

  it('still opens a retrieved log when cache writing fails', async () => {
    mockListLogs.mockResolvedValue([log('selected-log')]);
    mockPick.mockResolvedValue([{ logId: 'selected-log' }]);
    mockWriteFile.mockRejectedValue(new Error('read-only workspace'));
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();
    expect(mockCreateView).toHaveBeenCalled();
  });

  it('sorts logs newest first before presenting them', async () => {
    mockListLogs.mockResolvedValue([
      log('old', '2024-01-01T00:00:00.000Z'),
      log('new', '2024-01-03T00:00:00.000Z'),
    ]);
    let items: Array<{ logId: string }> = [];
    mockPick.mockImplementation((picked) => {
      items = picked;
      return Promise.resolve([]);
    });
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();
    expect(items.map((item) => item.logId)).toEqual(['new', 'old']);
  });

  it.each([
    [0, '0 ms'],
    [5.123, '5.12 ms'],
    [45.67, '45.7 ms'],
    [789.4, '789 ms'],
    [1234, '1.23 s'],
    [45678, '45.7 s'],
    [120000, '2m'],
    [150000, '2m 30s'],
    [125500, '2m 5.5s'],
  ])('formats %s milliseconds as %s', async (durationMilliseconds, expectedDuration) => {
    mockListLogs.mockResolvedValue([log('duration', undefined, durationMilliseconds)]);
    let description = '';
    mockPick.mockImplementation((items) => {
      description = items[0]?.desc ?? '';
      return Promise.resolve([]);
    });
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();
    expect(description).toContain(expectedDuration);
  });

  it('reports an access-denied log response', async () => {
    mockListLogs.mockResolvedValue([log('denied')]);
    mockPick.mockResolvedValue([{ logId: 'denied' }]);
    mockGetLogBody.mockResolvedValue('AccessDenied');
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();
    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Salesforce denied access'),
    );
  });
});
