/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { commands, Uri, window, workspace } from 'vscode';
import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { QuickPick } from '../../display/QuickPick.js';
import {
  ensureServicesAvailable,
  fileOrFolderExists,
  getLogBody,
  getTargetOrg,
  listLogs,
  writeFile,
} from '../../services/salesforceServices.js';
import { LogView } from '../LogView.js';
import { RetrieveLogFile } from '../RetrieveLogFile.js';

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
  ensureServicesAvailable: jest.fn(),
  fileOrFolderExists: jest.fn(),
  getLogBody: jest.fn(),
  getTargetOrg: jest.fn(),
  listLogs: jest.fn(),
  writeFile: jest.fn(),
}));
jest.mock('../LogView.js', () => ({ LogView: { createView: jest.fn() } }));

const mockPick = QuickPick.pick as jest.Mock;
const mockEnsureServicesAvailable = ensureServicesAvailable as jest.Mock;
const mockFileOrFolderExists = fileOrFolderExists as jest.Mock;
const mockListLogs = listLogs as jest.Mock;
const mockGetLogBody = getLogBody as jest.Mock;
const mockGetTargetOrg = getTargetOrg as jest.Mock;
const mockWriteFile = writeFile as jest.Mock;
const mockCreateView = LogView.createView as jest.Mock;
const mockRegisterCommand = commands.registerCommand as jest.Mock;
const mockWorkspace = workspace as unknown as {
  workspaceFolders: Array<{
    uri: ReturnType<typeof Uri.file>;
    name: string;
    index: number;
  }>;
};

const log = (id: string, startTime = '2024-01-01T00:00:00.000Z', durationMilliseconds = 100) => ({
  Id: id,
  LogUser: { Name: 'User' },
  Operation: 'Op',
  LogLength: 1024,
  DurationMilliseconds: durationMilliseconds,
  StartTime: startTime,
  Status: 'Success',
});

/** The deferred retrieve handed to LogView.createView as its beforeSendLog promise. */
function retrieveLogPromise(): Promise<string | void> {
  return mockCreateView.mock.calls[0]?.[1] as Promise<string | void>;
}

describe('RetrieveLogFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureServicesAvailable.mockResolvedValue(true);
    mockGetTargetOrg.mockResolvedValue('test@example.com');
    mockFileOrFolderExists.mockResolvedValue(false);
    mockWorkspace.workspaceFolders = [
      { uri: Uri.file('/test/workspace'), name: 'workspace', index: 0 },
    ];
    mockListLogs.mockResolvedValue([]);
    mockPick.mockResolvedValue([]);
    mockGetLogBody.mockResolvedValue('log body');
    mockWriteFile.mockResolvedValue(undefined);
    dismissPicker = () => undefined;
    picker = makePicker();
    (window.createQuickPick as jest.Mock).mockReturnValue(picker);
  });

  const makePicker = () => ({
    busy: false,
    enabled: true,
    placeholder: '',
    show: jest.fn(),
    dispose: jest.fn(),
    onDidHide: jest.fn((listener: () => void) => {
      dismissPicker = listener;
      return { dispose: jest.fn() };
    }),
  });

  let picker: ReturnType<typeof makePicker>;
  let dismissPicker: () => void;

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  const command = (): (() => Promise<unknown>) =>
    mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1]?.[1];

  it('closes the loading picker and says so when Salesforce cannot list the logs', async () => {
    mockListLogs.mockRejectedValue(new Error('no org connection'));
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);

    await command()();

    expect(picker.dispose).toHaveBeenCalled();
    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error loading logfile: no org connection',
    );
  });

  it('says so when no target org is set, instead of spinning for good', async () => {
    mockGetTargetOrg.mockResolvedValue(undefined);
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);

    await command()();

    expect(mockListLogs).not.toHaveBeenCalled();
    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error loading logfile: No target org is set. Authorize an org and set it as the target, then try again.',
    );
  });

  it('cancels the log list when the user dismisses the picker', async () => {
    mockListLogs.mockReturnValue(new Promise(() => {}));
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);

    const running = command()();
    await settle();
    const signal = mockListLogs.mock.calls[0]?.[0] as AbortSignal;
    expect(signal.aborted).toBe(false);

    dismissPicker();
    await running;

    expect(signal.aborted).toBe(true);
  });

  it('closes the loading picker and reports nothing when the user dismisses it', async () => {
    mockListLogs.mockReturnValue(new Promise(() => {}));
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);

    const running = command()();
    await settle();
    dismissPicker();
    await running;

    expect(picker.dispose).toHaveBeenCalled();
    expect(context.display.showErrorMessage).not.toHaveBeenCalled();
    expect(mockPick).not.toHaveBeenCalled();
  });

  it('registers the command', () => {
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    expect(context.context.subscriptions).toHaveLength(1);
  });

  it('lists logs through Salesforce Services', async () => {
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();
    expect(mockEnsureServicesAvailable).toHaveBeenCalledWith();
    expect(mockListLogs).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('retrieves and caches an uncached log', async () => {
    mockListLogs.mockResolvedValue([log('selected-log')]);
    mockPick.mockResolvedValue([{ logId: 'selected-log' }]);
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();

    expect(mockCreateView).toHaveBeenCalledWith(
      context,
      expect.any(Promise),
      expect.objectContaining({ path: expect.stringContaining('selected-log.log') }),
    );
    // A cached log is streamed from disk, so the body is never sent to the webview.
    await expect(retrieveLogPromise()).resolves.toBeUndefined();
    expect(mockGetLogBody).toHaveBeenCalledWith('selected-log');
    expect(mockFileOrFolderExists).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('selected-log.log') }),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('selected-log.log') }),
      'log body',
    );
  });

  it('uses the first workspace selected by Salesforce Services for the cache', async () => {
    mockWorkspace.workspaceFolders = [
      { uri: Uri.file('/test/first-workspace'), name: 'first', index: 0 },
      { uri: Uri.file('/test/second-workspace'), name: 'second', index: 1 },
    ];
    mockListLogs.mockResolvedValue([log('selected-log')]);
    mockPick.mockResolvedValue([{ logId: 'selected-log' }]);
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);

    await command()();

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/test/first-workspace') }),
      'log body',
    );
    expect(mockWriteFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/test/second-workspace') }),
      expect.anything(),
    );
  });

  it('opens a cached log without downloading it again', async () => {
    mockListLogs.mockResolvedValue([log('cached-log')]);
    mockPick.mockResolvedValue([{ logId: 'cached-log' }]);
    mockFileOrFolderExists.mockResolvedValue(true);
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();

    expect(mockGetLogBody).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockCreateView).toHaveBeenCalledWith(
      context,
      expect.any(Promise),
      expect.objectContaining({ path: expect.stringContaining('cached-log.log') }),
    );
  });

  it('stops before reading the workspace when Salesforce Services is unavailable', async () => {
    mockEnsureServicesAvailable.mockResolvedValue(false);
    mockWorkspace.workspaceFolders = [];
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();

    expect(mockListLogs).not.toHaveBeenCalled();
    expect(context.display.showErrorMessage).not.toHaveBeenCalled();
  });

  it('sends the log body inline when cache writing fails', async () => {
    mockListLogs.mockResolvedValue([log('selected-log')]);
    mockPick.mockResolvedValue([{ logId: 'selected-log' }]);
    mockWriteFile.mockRejectedValue(new Error('read-only workspace'));
    const context = createMockContext();
    RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
    await command()();

    expect(mockCreateView).toHaveBeenCalled();
    await expect(retrieveLogPromise()).resolves.toBe('log body');
    expect(context.display.output).toHaveBeenCalledWith(
      expect.stringContaining('Unable to cache retrieved log'),
      true,
    );
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

  it.each(['AccessDenied', 'Access denied', ' ACCESS   DENIED '])(
    'reports an access-denied log response: %s',
    async (response) => {
      mockListLogs.mockResolvedValue([log('denied')]);
      mockPick.mockResolvedValue([{ logId: 'denied' }]);
      mockGetLogBody.mockResolvedValue(response);
      const context = createMockContext();
      RetrieveLogFile.apply(context as unknown as import('../../Context.js').Context);
      await command()();
      await expect(retrieveLogPromise()).rejects.toThrow('Salesforce denied access');
    },
  );
});
