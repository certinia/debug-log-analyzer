/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import { FoldingRangeKind, languages, window, workspace } from 'vscode';

import {
  createMockDisplay,
  createMockApexLog,
  asContext,
  createMockContext,
  createMockLogEvent,
} from '../../__tests__/helpers/test-builders.js';
import {
  TabInputText,
  Uri,
  createMockTextDocument,
  setOpenTabs,
} from '../../__tests__/mocks/vscode.js';
import { LogEventCache } from '../../cache/LogEventCache.js';
import { RawLogFoldingProvider } from '../RawLogFoldingProvider.js';

// Mock LogEventCache
vi.mock('../../cache/LogEventCache.js', () => ({
  LogEventCache: {
    getApexLog: vi.fn(),
  },
}));

const mockGetApexLog = LogEventCache.getApexLog as Mock;

const line = (timestamp: number | null) =>
  timestamp === null ? 'Some non-timestamp line' : `09:45:31.888 (${timestamp})|EVENT`;

const event = (timestamp: number, exitStamp: number | null, children: LogEvent[] = []) =>
  createMockLogEvent({ timestamp, exitStamp, children });

describe('RawLogFoldingProvider', () => {
  let provider: RawLogFoldingProvider;

  beforeEach(() => {
    provider = new RawLogFoldingProvider(createMockDisplay());
    mockGetApexLog.mockReset();
    // The provider only works for a document the user has open as a text tab.
    setOpenTabs(new TabInputText(Uri.file('/test/file.log')));
  });

  async function foldsFor(timestamps: Array<number | null>, apexLog: ApexLog | null) {
    const doc = createMockTextDocument({ lines: timestamps.map(line), uri: '/test/file.log' });
    mockGetApexLog.mockResolvedValueOnce(apexLog);
    const ranges = await provider.provideFoldingRanges(doc, {} as never);
    return ranges.map((range) => [range.start, range.end, range.kind]);
  }

  const logOf = (...children: LogEvent[]) => createMockApexLog({ children });
  const region = (start: number, end: number) => [start, end, FoldingRangeKind.Region];

  it.each([
    ['an event', [1000, 1500, 2000], logOf(event(1000, 2000)), [region(0, 2)]],
    [
      'an event over an untimestamped line',
      [1000, null, 2000],
      logOf(event(1000, 2000)),
      [region(0, 2)],
    ],
    [
      'the first line of a repeated timestamp',
      [1000, 1000, 2000],
      logOf(event(1000, 2000)),
      [region(0, 2)],
    ],
    [
      'a parent and its child',
      [1000, 1500, 2000, 3000],
      logOf(event(1000, 3000, [event(1500, 2000)])),
      [region(0, 3), region(1, 2)],
    ],
    [
      'three levels',
      [1000, 2000, 3000, 4000, 5000, 6000],
      logOf(event(1000, 6000, [event(2000, 5000, [event(3000, 4000)])])),
      [region(0, 5), region(1, 4), region(2, 3)],
    ],
    [
      'siblings',
      [1000, 2000, 3000, 4000],
      logOf(event(1000, 2000), event(3000, 4000)),
      [region(0, 1), region(2, 3)],
    ],
  ])('folds %s', async (_label, timestamps, apexLog, expected) => {
    expect(await foldsFor(timestamps, apexLog)).toEqual(expected);
  });

  it.each([
    ['an event that exits where it starts', [1000], logOf(event(1000, 1000))],
    ['an event with no exit', [1000], logOf(event(1000, null))],
    ['an event whose exit line comes first', [2000, 1000], logOf(event(1000, 2000))],
    ['an event whose timestamps are not in the document', [1000], logOf(event(9999, 10000))],
    ['an empty log', [], logOf()],
    ['a log that did not parse', [], null],
  ])('folds nothing for %s', async (_label, timestamps, apexLog) => {
    expect(await foldsFor(timestamps, apexLog)).toEqual([]);
  });

  it('folds nothing for a document not open as a text tab', async () => {
    setOpenTabs();
    expect(await foldsFor([1000, 2000], logOf(event(1000, 2000)))).toEqual([]);
  });

  describe('apply', () => {
    it('registers the provider for apexlog', () => {
      RawLogFoldingProvider.apply(asContext(createMockContext()));

      expect(languages.registerFoldingRangeProvider).toHaveBeenCalledTimes(1);
      expect(languages.registerFoldingRangeProvider).toHaveBeenCalledWith(
        [{ language: 'apexlog' }],
        expect.any(RawLogFoldingProvider),
      );
    });

    it('warms on tab changes, not on document open', () => {
      RawLogFoldingProvider.apply(asContext(createMockContext()));

      // onDidOpenTextDocument fires before the tab model updates, so isOpenAsTextTab
      // would reject a legitimate open.
      expect(window.tabGroups.onDidChangeTabs).toHaveBeenCalledTimes(1);
      expect(workspace.onDidOpenTextDocument).not.toHaveBeenCalled();
    });
  });

  describe('signals VS Code when a log is parsed', () => {
    // An EXECUTION_STARTED line makes isApexLogContent() return true.
    const apexLogLines = ['16:35:06.2 (2706460)|EXECUTION_STARTED'];

    function applyAndCapture() {
      const mockContext = createMockContext();
      RawLogFoldingProvider.apply(asContext(mockContext));

      const registeredProvider = (languages.registerFoldingRangeProvider as Mock).mock
        .calls[0]?.[1] as RawLogFoldingProvider;
      const tabsHandler = (window.tabGroups.onDidChangeTabs as Mock).mock.calls[0]?.[0] as (
        event: unknown,
      ) => void;
      const activeEditorHandler = (window.onDidChangeActiveTextEditor as Mock).mock
        .calls[0]?.[0] as (editor: unknown) => void;

      // The tab handler reads the active editor rather than taking a document.
      const fireTabChange = (doc: unknown) => {
        window.activeTextEditor = { document: doc } as typeof window.activeTextEditor;
        tabsHandler({});
      };
      const fireActiveEditor = (doc: unknown) => activeEditorHandler({ document: doc });
      const fired = vi.fn();
      registeredProvider.onDidChangeFoldingRanges?.(fired);

      return { fireTabChange, fireActiveEditor, fired, display: mockContext.display };
    }

    const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
    const logUri = expect.objectContaining({ scheme: 'file', path: '/test/file.log' });

    it.each([
      ['a tab change', 'fireTabChange'],
      ['an editor becoming active (reopen)', 'fireActiveEditor'],
    ] as const)('warms the cache and fires after %s', async (_label, trigger) => {
      const captured = applyAndCapture();
      mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [] }));

      captured[trigger](createMockTextDocument({ lines: apexLogLines, uri: '/test/file.log' }));
      await flush();

      expect(mockGetApexLog).toHaveBeenCalledWith(logUri, captured.display);
      expect(captured.fired).toHaveBeenCalledTimes(1);
    });

    it('does not warm or signal for a non-apex-log document', async () => {
      const { fireTabChange, fired } = applyAndCapture();

      fireTabChange(createMockTextDocument({ lines: ['just some text'], uri: '/test/notes.log' }));
      await flush();

      expect(mockGetApexLog).not.toHaveBeenCalled();
      expect(fired).not.toHaveBeenCalled();
    });

    it('does not fire when the log fails to parse', async () => {
      const { fireTabChange, fired, display } = applyAndCapture();
      mockGetApexLog.mockResolvedValueOnce(null);

      fireTabChange(createMockTextDocument({ lines: apexLogLines, uri: '/test/file.log' }));
      await flush();

      expect(mockGetApexLog).toHaveBeenCalledWith(logUri, display);
      expect(fired).not.toHaveBeenCalled();
    });
  });
});
