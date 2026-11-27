/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Uri, window, workspace } from 'vscode';
import { memoryFs } from '../../__tests__/helpers/memoryFs.js';
import {
  asContext,
  createMockContext,
  lastRegisteredCommand,
} from '../../__tests__/helpers/test-builders.js';
import {
  ensureServicesAvailable,
  getLogBody,
  getTargetOrg,
  listLogs,
  writeFile,
} from '../../services/salesforceServices.js';
import { LogView } from '../LogView.js';
import { RetrieveLogFile } from '../RetrieveLogFile.js';

jest.mock('../../services/salesforceServices.js', () => ({
  ensureServicesAvailable: jest.fn(),
  getLogBody: jest.fn(),
  getTargetOrg: jest.fn(),
  listLogs: jest.fn(),
  writeFile: jest.fn(),
}));
jest.mock('../LogView.js', () => ({ LogView: { createView: jest.fn() } }));

const mockEnsureServicesAvailable = ensureServicesAvailable as jest.Mock;
const mockListLogs = listLogs as jest.Mock;
const mockGetLogBody = getLogBody as jest.Mock;
const mockGetTargetOrg = getTargetOrg as jest.Mock;
const mockWriteFile = writeFile as jest.Mock;
const mockCreateView = LogView.createView as jest.Mock;
const mockFs = workspace.fs as unknown as Record<
  'readDirectory' | 'readFile' | 'writeFile' | 'delete',
  jest.Mock
>;
const OPENED = '/test/workspace/.sfdx/tools/debug/logs';
const SEARCH_CACHE = '/test/storage/apex-logs/00Dorg';
const OTHER_ORG_LOG = '/test/storage/apex-logs/00Dother/other.log';

/** Lays out cached logs by folder path: `{ [folder]: { [logId]: body } }`. */
function cachedLogs(folders: Record<string, Record<string, string>>) {
  const split = (path: string) =>
    [
      path.slice(0, path.lastIndexOf('/')),
      path.slice(path.lastIndexOf('/') + 1, -'.log'.length),
    ] as const;
  mockFs.readDirectory.mockImplementation(async (uri: Uri) => {
    const logs = folders[uri.path];
    if (!logs) {
      throw new Error('no folder');
    }
    return Object.keys(logs).map((logId) => [`${logId}.log`, 1]);
  });
  mockFs.readFile.mockImplementation(async (uri: Uri) => {
    const [folder, logId] = split(uri.path);
    const body = folders[folder]?.[logId];
    if (body === undefined) {
      throw new Error('no file');
    }
    return new TextEncoder().encode(body);
  });
}
const mockWorkspace = workspace as unknown as {
  workspaceFolders: Array<{
    uri: ReturnType<typeof Uri.file>;
    name: string;
    index: number;
  }>;
};

const MB = 1024 * 1024;
/** Leaves the log list open, so a case can type into it. */
const KEEP_OPEN = Symbol('keep open');

const log = (
  id: string,
  startTime = '2024-01-01T00:00:00.000Z',
  durationMilliseconds = 100,
  logLength = 1024,
) => ({
  Id: id,
  LogUser: { Name: 'User' },
  Operation: 'Op',
  LogLength: logLength,
  DurationMilliseconds: durationMilliseconds,
  StartTime: startTime,
  Status: 'Success',
});

interface PickerItem {
  label: string;
  description?: string;
  detail?: string;
  alwaysShow?: boolean;
  logId?: string;
}

interface PickerButton {
  tooltip?: string;
}

const makePicker = () => {
  const on: {
    hide?: () => void;
    accept?: () => void;
    change?: (value: string) => void;
    button?: (button: PickerButton) => Promise<void>;
  } = {};
  const picker = {
    buttons: [] as PickerButton[],
    busy: false,
    enabled: true,
    placeholder: '',
    title: undefined as string | undefined,
    value: '',
    matchOnDescription: false,
    matchOnDetail: false,
    keepScrollPosition: false,
    shownItems: [] as PickerItem[],
    // As in VS Code, new items clear the highlighted row.
    get items(): PickerItem[] {
      return picker.shownItems;
    },
    set items(items: PickerItem[]) {
      picker.shownItems = items;
      picker.activeItems = [];
    },
    activeItems: [] as PickerItem[],
    selectedItems: [] as PickerItem[],
    show: jest.fn(),
    dispose: jest.fn(),
    hide: jest.fn(() => on.hide?.()),
    onDidHide: jest.fn((listener: () => void) => {
      on.hide = listener;
      return { dispose: jest.fn() };
    }),
    onDidAccept: jest.fn((listener: () => void) => {
      on.accept = listener;
      return { dispose: jest.fn() };
    }),
    onDidChangeValue: jest.fn((listener: (value: string) => void) => {
      on.change = listener;
      return { dispose: jest.fn() };
    }),
    onDidTriggerButton: jest.fn((listener: (button: PickerButton) => Promise<void>) => {
      on.button = listener;
      return { dispose: jest.fn() };
    }),
    async press(button: PickerButton | undefined) {
      if (button) {
        await on.button?.(button);
      }
    },
    accept(item: PickerItem | undefined) {
      picker.selectedItems = item ? [item] : [];
      on.accept?.();
    },
    type(value: string) {
      picker.value = value;
      on.change?.(value);
    },
    dismiss() {
      on.hide?.();
    },
    item(logId: string) {
      return picker.items.find((item) => item.logId === logId);
    },
  };
  return picker;
};

describe('RetrieveLogFile', () => {
  let loadingPicker: ReturnType<typeof makePicker>;
  let listPicker: ReturnType<typeof makePicker>;
  let pickOnShow: string | null | typeof KEEP_OPEN;

  beforeEach(() => {
    mockEnsureServicesAvailable.mockResolvedValue(true);
    mockWorkspace.workspaceFolders = [
      { uri: Uri.file('/test/workspace'), name: 'workspace', index: 0 },
    ];
    mockListLogs.mockResolvedValue([]);
    mockGetLogBody.mockResolvedValue('log body');
    mockGetTargetOrg.mockResolvedValue({ orgId: '00Dorg', alias: 'myorg', username: 'me@x.com' });
    mockWriteFile.mockResolvedValue(undefined);
    mockFs.readDirectory.mockRejectedValue(new Error('no folder'));
    mockFs.readFile.mockResolvedValue(new Uint8Array());
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.delete.mockResolvedValue(undefined);

    pickOnShow = null;
    loadingPicker = makePicker();
    listPicker = makePicker();
    listPicker.show.mockImplementation(() => {
      if (pickOnShow === null) {
        listPicker.dismiss();
      } else if (pickOnShow !== KEEP_OPEN) {
        listPicker.accept(listPicker.item(pickOnShow));
      }
    });
    const pickers = [loadingPicker, listPicker];
    (window.createQuickPick as jest.Mock).mockImplementation(() => pickers.shift());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  const command = lastRegisteredCommand;

  async function run(
    logs: ReturnType<typeof log>[],
    pick: string | null | typeof KEEP_OPEN = null,
  ) {
    mockListLogs.mockResolvedValue(logs);
    pickOnShow = pick;
    const context = createMockContext();
    RetrieveLogFile.apply(asContext(context));
    const running = command()();
    return { context, running };
  }

  /** The deferred retrieve handed to LogView.createView as its beforeSendLog promise. */
  function retrieveLogPromise(): Promise<string | void> {
    return mockCreateView.mock.calls[0]?.[1] as Promise<string | void>;
  }

  /** Lets a running content search download, match and finish. */
  async function settleSearch() {
    for (let i = 0; i < 5; i++) {
      await settle();
    }
  }

  async function openList(logs: ReturnType<typeof log>[]) {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const started = await run(logs, KEEP_OPEN);
    await settle();
    return started;
  }

  /** Types a term, then waits out the search delay and the search. */
  async function typeAndSettle(term: string) {
    listPicker.type(term);
    jest.advanceTimersByTime(400);
    await settleSearch();
  }

  async function searchFor(term: string, logs: ReturnType<typeof log>[]) {
    const started = await openList(logs);
    await typeAndSettle(term);
    return started;
  }

  it('closes the loading picker and says so when Salesforce cannot list the logs', async () => {
    mockListLogs.mockRejectedValue(new Error('no org connection'));
    const context = createMockContext();
    RetrieveLogFile.apply(asContext(context));

    await command()();

    expect(loadingPicker.dispose).toHaveBeenCalled();
    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error loading logfile: no org connection',
    );
  });

  it('cancels the log list, closes the picker and reports nothing when the user dismisses it', async () => {
    mockListLogs.mockReturnValue(new Promise(() => {}));
    const context = createMockContext();
    RetrieveLogFile.apply(asContext(context));

    const running = command()();
    await settle();
    const signal = mockListLogs.mock.calls[0]?.[0] as AbortSignal;
    expect(signal.aborted).toBe(false);

    loadingPicker.dismiss();
    await running;

    expect(signal.aborted).toBe(true);
    expect(loadingPicker.dispose).toHaveBeenCalled();
    expect(context.display.showErrorMessage).not.toHaveBeenCalled();
    expect(listPicker.show).not.toHaveBeenCalled();
  });

  it('retrieves and caches an uncached log in the log folder the Salesforce extensions use', async () => {
    const { context, running } = await run([log('selected-log')], 'selected-log');
    await running;

    const cachePath = `${OPENED}/selected-log.log`;
    expect(mockCreateView).toHaveBeenCalledWith(
      context,
      expect.any(Promise),
      expect.objectContaining({ path: cachePath }),
    );
    // A cached log is streamed from disk, so the body is never sent to the webview.
    await expect(retrieveLogPromise()).resolves.toBeUndefined();
    expect(mockGetLogBody).toHaveBeenCalledWith('selected-log');
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: cachePath }),
      'log body',
    );
  });

  it('deletes no cached log when the org Id is unknown', async () => {
    mockGetTargetOrg.mockResolvedValue({});
    mockFs.readDirectory.mockResolvedValue([['gone.log', 1]]);
    const { running } = await run([log('selected-log')], 'selected-log');
    await running;
    await retrieveLogPromise();

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${OPENED}/selected-log.log` }),
      'log body',
    );
    expect(mockFs.delete).not.toHaveBeenCalled();
  });

  it('deletes searched logs the org no longer has, but never a log the user opened or another org', async () => {
    cachedLogs({
      [OPENED]: { 'opened-gone': '' },
      [SEARCH_CACHE]: { kept: '', gone: '' },
      '/test/storage/apex-logs/00Dother': { other: '' },
    });
    const { running } = await run([log('kept')]);
    await running;

    expect(mockFs.delete).toHaveBeenCalledTimes(1);
    expect(mockFs.delete).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${SEARCH_CACHE}/gone.log` }),
    );
  });

  it('opens a log found by search from the search cache, without downloading it', async () => {
    cachedLogs({ [SEARCH_CACHE]: { searched: 'searched body' } });
    const { running } = await run([log('searched')], 'searched');
    await running;

    await expect(retrieveLogPromise()).resolves.toBeUndefined();
    expect(mockGetLogBody).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${OPENED}/searched.log` }),
      'searched body',
    );
  });

  it('uses the first workspace selected by Salesforce Services for the cache', async () => {
    mockWorkspace.workspaceFolders = [
      { uri: Uri.file('/test/first-workspace'), name: 'first', index: 0 },
      { uri: Uri.file('/test/second-workspace'), name: 'second', index: 1 },
    ];
    const { running } = await run([log('selected-log')], 'selected-log');
    await running;
    await retrieveLogPromise();

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
    mockFs.readDirectory.mockResolvedValue([['cached-log.log', 1]]);
    const { context, running } = await run([log('cached-log')], 'cached-log');
    await running;

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
    RetrieveLogFile.apply(asContext(context));
    await command()();

    expect(mockListLogs).not.toHaveBeenCalled();
    expect(context.display.showErrorMessage).not.toHaveBeenCalled();
  });

  it('sends the log body inline when cache writing fails', async () => {
    mockWriteFile.mockRejectedValue(new Error('read-only workspace'));
    const { context, running } = await run([log('selected-log')], 'selected-log');
    await running;

    expect(mockCreateView).toHaveBeenCalled();
    await expect(retrieveLogPromise()).resolves.toBe('log body');
    expect(context.display.output).toHaveBeenCalledWith(
      expect.stringContaining('Unable to cache retrieved log'),
      true,
    );
  });

  it('sorts logs newest first before presenting them', async () => {
    const { running } = await run([
      log('old', '2024-01-01T00:00:00.000Z'),
      log('new', '2024-01-03T00:00:00.000Z'),
    ]);
    await running;

    expect(listPicker.items.map((item) => item.logId)).toEqual(['new', 'old']);
  });

  it.each([
    [
      { orgId: '00Dorg', alias: 'myorg', username: 'me@x.com' },
      'Select a log, or type 3+ characters to search inside logs (myorg)',
    ],
    [
      { orgId: '00Dorg', username: 'me@x.com' },
      'Select a log, or type 3+ characters to search inside logs (me@x.com)',
    ],
    [{}, 'Select a log, or type 3+ characters to search inside logs'],
  ])('names the org in the placeholder: %j', async (targetOrg, placeholder) => {
    mockGetTargetOrg.mockResolvedValue(targetOrg);
    const { running } = await run([log('a')]);
    await running;

    expect(listPicker.placeholder).toBe(placeholder);
  });

  it('opens the list without an org name when the default org cannot be read', async () => {
    mockGetTargetOrg.mockRejectedValue(new Error('no default org'));
    const { context, running } = await run([log('a')]);
    await running;

    expect(context.display.output).toHaveBeenCalledWith(
      'Unable to read the default org: no default org',
    );
    expect(listPicker.placeholder).toBe(
      'Select a log, or type 3+ characters to search inside logs',
    );
  });

  it('filters rows on their metadata as the user types', async () => {
    const { running } = await run([log('a')]);
    await running;

    expect(listPicker.matchOnDescription).toBe(true);
    expect(listPicker.matchOnDetail).toBe(true);
    expect(listPicker.item('a')?.alwaysShow).toBe(false);
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
    const { running } = await run([log('duration', undefined, durationMilliseconds)]);
    await running;

    expect(listPicker.item('duration')?.description).toContain(expectedDuration);
  });

  it.each(['AccessDenied', 'Access denied', ' ACCESS   DENIED '])(
    'reports an access-denied log response: %s',
    async (response) => {
      mockGetLogBody.mockResolvedValue(response);
      const { running } = await run([log('denied')], 'denied');
      await running;

      await expect(retrieveLogPromise()).rejects.toThrow('Salesforce denied access');
    },
  );

  describe('content search', () => {
    const day = (n: number) => `2024-01-${String(n).padStart(2, '0')}T00:00:00.000Z`;
    /** Seven uncached 2 MB logs, `log-7` the newest. */
    const sevenLogs = () =>
      Array.from({ length: 7 }, (_, i) => log(`log-${i + 1}`, day(i + 1), 100, 2 * MB));

    it('searches cached logs as the user types, without downloading anything', async () => {
      cachedLogs({ [SEARCH_CACHE]: { cached: 'line one\nFATAL_ERROR System.LimitException' } });
      await searchFor('fatal_error', [log('cached', day(1)), log('remote', day(2))]);

      const row = listPicker.item('cached');
      expect(mockGetLogBody).not.toHaveBeenCalled();
      expect(row?.alwaysShow).toBe(true);
      expect(row?.detail).toBe('line one FATAL_ERROR System.LimitException');
      expect(row?.description).toContain('Success - cached');
      expect(listPicker.busy).toBe(false);
      expect(listPicker.title).toBe('Searched 1 log · 1 match · 1 not searched');
    });

    it('puts a search row first, labelled with the term, offering the newest 5 logs', async () => {
      await searchFor('fatal_error', sevenLogs());

      expect(listPicker.items[0]).toMatchObject({
        label: 'fatal_error',
        description: '- Search newest 5 logs (10.0 MB) · Downloads from the org',
        alwaysShow: true,
      });
      expect(mockGetLogBody).not.toHaveBeenCalled();
    });

    it('downloads only the newest 5 logs not already cached', async () => {
      cachedLogs({ [SEARCH_CACHE]: { 'log-7': 'clean', 'log-5': 'clean' } });
      await searchFor('fatal_error', sevenLogs());

      expect(listPicker.items[0]?.description).toBe(
        '- Search newest 5 logs (download 3, 6.0 MB) · Downloads from the org',
      );
      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      expect(mockGetLogBody.mock.calls.map(([id]) => id)).toEqual(['log-6', 'log-4', 'log-3']);
    });

    it('offers the older logs straight away when the newest 5 are cached', async () => {
      cachedLogs({
        [SEARCH_CACHE]: { 'log-7': 'a', 'log-6': 'a', 'log-5': 'a', 'log-4': 'a', 'log-3': 'a' },
      });
      await searchFor('fatal_error', sevenLogs());

      expect(listPicker.items[0]?.description).toBe(
        '- Search 2 older logs (4.0 MB) · Downloads from the org',
      );
    });

    it('downloads the newest 5 into the search cache when the row is picked, then offers the rest', async () => {
      mockGetLogBody.mockImplementation(async (id: string) =>
        id === 'log-6' ? 'FATAL_ERROR here' : 'clean',
      );
      await searchFor('fatal_error', sevenLogs());

      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      expect(mockGetLogBody.mock.calls.map(([id]) => id)).toEqual([
        'log-7',
        'log-6',
        'log-5',
        'log-4',
        'log-3',
      ]);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: `${SEARCH_CACHE}/log-7.log` }),
        expect.any(Uint8Array),
      );
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(listPicker.item('log-6')?.alwaysShow).toBe(true);
      expect(listPicker.items[0]?.description).toBe(
        '- Search 2 older logs (4.0 MB) · Downloads from the org',
      );
      expect(listPicker.title).toBe('Searched 5 logs · 1 match · 2 older not searched');
    });

    it('searches older logs 50 at a time', async () => {
      const minute = Date.UTC(2024, 0, 1);
      const logs = Array.from({ length: 57 }, (_, i) =>
        log(`log-${i + 1}`, new Date(minute + i * 60_000).toISOString(), 100, 2 * MB),
      );
      await searchFor('fatal_error', logs);
      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      expect(listPicker.items[0]?.description).toBe(
        '- Search next 50 older logs (100.0 MB) · Downloads from the org',
      );
      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      expect(mockGetLogBody).toHaveBeenCalledTimes(55);
      expect(listPicker.items[0]?.description).toBe(
        '- Search 2 older logs (4.0 MB) · Downloads from the org',
      );
    });

    it('keeps the search row, with a spinner, while it downloads', async () => {
      await searchFor('fatal_error', sevenLogs());

      listPicker.accept(listPicker.items[0]);
      expect(listPicker.items[0]).toMatchObject({
        label: 'fatal_error',
        description: '- Searching 5 logs…',
        iconPath: { id: 'loading~spin' },
      });
      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      expect(mockGetLogBody).toHaveBeenCalledTimes(5);
      expect(listPicker.items[0]).toMatchObject({ iconPath: { id: 'cloud-download' } });
    });

    it('searches the rest when the row is picked again, then drops the row', async () => {
      await searchFor('fatal_error', sevenLogs());
      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      expect(mockGetLogBody).toHaveBeenCalledTimes(7);
      expect(listPicker.items[0]?.logId).toBe('log-7');
      expect(listPicker.title).toBe('Searched 7 logs · 0 matches');
    });

    it('names logs it could not download, shows why, and retries them on the next press', async () => {
      mockGetLogBody.mockImplementation(async (id: string) => {
        if (id === 'log-6') {
          throw new Error('REQUEST_LIMIT_EXCEEDED');
        }
        return 'clean';
      });
      const { context } = await searchFor('fatal_error', sevenLogs());

      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      expect(listPicker.title).toBe(
        'Searched 4 logs · 0 matches · 1 failed, see Output · 3 older not searched',
      );
      expect(context.display.output).toHaveBeenCalledWith(
        expect.stringContaining('Apex log log-6: REQUEST_LIMIT_EXCEEDED'),
        true,
      );

      mockGetLogBody.mockResolvedValue('clean');
      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      expect(mockGetLogBody.mock.calls.filter(([id]) => id === 'log-6')).toHaveLength(2);
      expect(listPicker.title).toBe('Searched 7 logs · 0 matches');
    });

    it('reports an access-denied body found by search and does not cache it', async () => {
      mockGetLogBody.mockResolvedValue('AccessDenied');
      const { context } = await searchFor('fatal_error', [log('denied')]);

      listPicker.accept(listPicker.items[0]);
      await settleSearch();

      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(context.display.output).toHaveBeenCalledWith(
        expect.stringContaining('Salesforce denied access to the body of Apex log denied'),
        true,
      );
    });

    describe('while logs download', () => {
      let release: (body?: string) => void;

      beforeEach(() => {
        const waiting: Array<(body: string) => void> = [];
        mockGetLogBody.mockImplementation(
          () => new Promise<string>((resolve) => waiting.push(resolve)),
        );
        release = (body = 'clean') => waiting.splice(0).forEach((resolve) => resolve(body));
      });

      it('shows progress in the title, counting on from the last press', async () => {
        await searchFor('fatal_error', sevenLogs());

        listPicker.accept(listPicker.items[0]);
        expect(listPicker.title).toBe('Searching 0/5 · 0 matches · 2 older not searched');
        release();
        await settleSearch();

        listPicker.accept(listPicker.items[0]);
        expect(listPicker.title).toBe('Searching 5/7 · 0 matches');
        release();
        await settleSearch();
      });

      it('ignores a match for the old term that arrives after the term changes', async () => {
        await searchFor('fatal_error', sevenLogs());
        listPicker.accept(listPicker.items[0]);

        await typeAndSettle('other_term');
        release('FATAL_ERROR');
        await settleSearch();
        jest.advanceTimersByTime(100);

        expect(listPicker.items.filter((item) => item.logId && item.alwaysShow)).toEqual([]);
      });

      it('still caches a running download when the list closes', async () => {
        const { running } = await searchFor('fatal_error', sevenLogs());
        listPicker.accept(listPicker.items[0]);

        listPicker.dismiss();
        await running;
        release();
        await settleSearch();

        expect(mockCreateView).not.toHaveBeenCalled();
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.objectContaining({ path: `${SEARCH_CACHE}/log-7.log` }),
          expect.any(Uint8Array),
        );
      });

      it('downloads each log once when the term changes', async () => {
        await searchFor('fatal_error', sevenLogs());
        listPicker.accept(listPicker.items[0]);
        await typeAndSettle('other_term');
        listPicker.accept(listPicker.items[0]);
        release();
        await settleSearch();

        expect(mockGetLogBody).toHaveBeenCalledTimes(5);
      });

      it('opens a log still downloading for search without a second download', async () => {
        await searchFor('fatal_error', sevenLogs());
        listPicker.accept(listPicker.items[0]);
        listPicker.accept(listPicker.item('log-7'));
        release();
        await settleSearch();

        expect(mockGetLogBody).toHaveBeenCalledTimes(5);
        await expect(retrieveLogPromise()).resolves.toBeUndefined();
      });

      it('writes nothing back to a search cache cleared during a download', async () => {
        cachedLogs({ [SEARCH_CACHE]: { cached: '' } });
        (window.showWarningMessage as jest.Mock).mockResolvedValue('Delete');
        await searchFor('fatal_error', [...sevenLogs(), log('cached')]);
        listPicker.accept(listPicker.items[0]);

        await listPicker.press(listPicker.buttons[0]);
        release();
        await settleSearch();

        expect(mockFs.writeFile).not.toHaveBeenCalled();
      });
    });

    it('offers no search under three characters', async () => {
      cachedLogs({ [SEARCH_CACHE]: { cached: 'ab' } });
      await searchFor('ab', [log('cached'), log('remote')]);

      expect(listPicker.items[0]?.logId).toBeDefined();
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it('waits for a pause in typing before it searches cached logs', async () => {
      cachedLogs({ [SEARCH_CACHE]: { cached: 'fatal' } });
      const { running } = await openList([log('cached')]);

      listPicker.type('fatal');
      jest.advanceTimersByTime(399);
      await settle();
      expect(mockFs.readFile).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await settle();
      expect(mockFs.readFile).toHaveBeenCalled();

      listPicker.dismiss();
      await running;
    });

    it('clears earlier matches when the term changes', async () => {
      cachedLogs({ [SEARCH_CACHE]: { match: 'FATAL_ERROR' } });
      await searchFor('fatal_error', [log('match')]);
      expect(listPicker.item('match')?.alwaysShow).toBe(true);

      listPicker.type('other');

      expect(listPicker.item('match')?.alwaysShow).toBe(false);
      expect(listPicker.item('match')?.detail).toContain('Success - match');
    });

    it('keeps the search when only spaces around the term change', async () => {
      cachedLogs({ [SEARCH_CACHE]: { match: 'FATAL_ERROR' } });
      await searchFor('fatal_error', [log('match')]);
      const reads = mockFs.readFile.mock.calls.length;

      await typeAndSettle('fatal_error ');

      expect(listPicker.item('match')?.alwaysShow).toBe(true);
      expect(mockFs.readFile).toHaveBeenCalledTimes(reads);
    });

    it('stops a waiting search when the list closes', async () => {
      cachedLogs({ [SEARCH_CACHE]: { cached: 'fatal' } });
      const { running } = await openList([log('cached')]);

      listPicker.type('fatal');
      listPicker.dismiss();
      jest.advanceTimersByTime(400);
      await settle();
      await running;

      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it('keeps the highlighted row when matches arrive', async () => {
      cachedLogs({ [SEARCH_CACHE]: { first: 'FATAL_ERROR', second: 'FATAL_ERROR' } });
      const { running } = await openList([log('first'), log('second')]);
      const highlighted = listPicker.item('second');
      listPicker.activeItems = highlighted ? [highlighted] : [];

      await typeAndSettle('fatal_error');
      jest.advanceTimersByTime(100);

      expect(listPicker.activeItems).toEqual([highlighted]);
      expect(listPicker.keepScrollPosition).toBe(true);
      listPicker.dismiss();
      await running;
    });

    it.each([
      ['Delete', true],
      [undefined, false],
    ])(
      'clears the org search cache from the title button only when confirmed: %s',
      async (answer, cleared) => {
        const fs = memoryFs();
        fs.put(`${SEARCH_CACHE}/a.log`, '');
        fs.put(`${SEARCH_CACHE}/b.log`, '');
        fs.put(OTHER_ORG_LOG, '');
        (window.showWarningMessage as jest.Mock).mockResolvedValue(answer);
        const { running } = await openList([
          log('a', day(1), 100, 2 * MB),
          log('b', day(2), 100, 3 * MB),
        ]);
        expect(listPicker.buttons[0]?.tooltip).toBe('Clear 2 cached logs (5.0 MB)');

        await listPicker.press(listPicker.buttons[0]);

        expect(window.showWarningMessage).toHaveBeenCalledWith(
          'Delete 2 cached Apex logs (5.0 MB) for myorg? Logs you opened in .sfdx are kept.',
          { modal: true },
          'Delete',
        );
        expect(fs.paths()).toEqual(
          cleared
            ? [OTHER_ORG_LOG]
            : [`${SEARCH_CACHE}/a.log`, `${SEARCH_CACHE}/b.log`, OTHER_ORG_LOG],
        );
        expect(listPicker.buttons).toHaveLength(cleared ? 0 : 1);
        listPicker.dismiss();
        await running;
      },
    );
  });
});
