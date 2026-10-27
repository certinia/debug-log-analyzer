/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { FoldingRangeKind, languages, window, workspace } from 'vscode';

import {
  createMockDisplay,
  createMockApexLog,
  asContext,
  createMockContext,
  logLine,
  parseLines,
} from '../../__tests__/helpers/test-builders.js';
import {
  TabInputText,
  Uri,
  createMockTextDocument,
  setOpenTabs,
} from '../../__tests__/mocks/vscode.js';
import { LogEventCache } from '../../cache/LogEventCache.js';
import { RawLogFoldingProvider } from '../RawLogFoldingProvider.js';

// Only the parse is mocked: the lines of each event are read as the provider reads them.
jest.mock('../../cache/LogEventCache.js', () => {
  const actual = jest.requireActual<typeof import('../../cache/LogEventCache.js')>(
    '../../cache/LogEventCache.js',
  );
  actual.LogEventCache.getApexLog = jest.fn();
  return actual;
});

const mockGetApexLog = LogEventCache.getApexLog as jest.Mock;

const enter = (ns: number, name = 'A.a()') => logLine(ns, `METHOD_ENTRY|[1]|01p|${name}`);
const exit = (ns: number, name = 'A.a()') => logLine(ns, `METHOD_EXIT|[1]|${name}`);
const debug = (ns: number) => logLine(ns, 'USER_DEBUG|[2]|DEBUG|hello');

describe('RawLogFoldingProvider', () => {
  let provider: RawLogFoldingProvider;

  beforeEach(() => {
    provider = new RawLogFoldingProvider(createMockDisplay());
    mockGetApexLog.mockReset();
    // The provider only works for a document the user has open as a text tab.
    setOpenTabs(new TabInputText(Uri.file('/test/file.log')));
  });

  async function foldsFor(lines: string[], parsed = true) {
    const doc = createMockTextDocument({ lines, uri: '/test/file.log' });
    mockGetApexLog.mockResolvedValueOnce(parsed ? await parseLines(lines) : null);
    const ranges = await provider.provideFoldingRanges(doc, {} as never);
    return ranges.map((range) => [range.start, range.end, range.kind]);
  }

  const region = (start: number, end: number) => [start, end, FoldingRangeKind.Region];

  it.each([
    ['a method', [enter(1000), debug(1500), exit(2000)], [region(0, 2)]],
    [
      'a method over a line with no timestamp',
      [enter(1000), debug(1500), 'more of the message', exit(2000)],
      [region(0, 3)],
    ],
    [
      'two methods that start at one timestamp',
      [enter(1000, 'A.a()'), enter(1000, 'A.b()'), exit(2000, 'A.b()'), exit(2000, 'A.a()')],
      [region(0, 3), region(1, 2)],
    ],
    [
      'a parent and its child',
      [enter(1000, 'A.a()'), enter(1500, 'A.b()'), exit(2000, 'A.b()'), exit(3000, 'A.a()')],
      [region(0, 3), region(1, 2)],
    ],
    [
      'three levels',
      [
        enter(1000, 'A.a()'),
        enter(2000, 'A.b()'),
        enter(3000, 'A.c()'),
        exit(4000, 'A.c()'),
        exit(5000, 'A.b()'),
        exit(6000, 'A.a()'),
      ],
      [region(0, 5), region(1, 4), region(2, 3)],
    ],
    [
      'siblings',
      [enter(1000, 'A.a()'), exit(2000, 'A.a()'), enter(3000, 'A.b()'), exit(4000, 'A.b()')],
      [region(0, 1), region(2, 3)],
    ],
  ])('folds %s', async (_label, lines, expected) => {
    expect(await foldsFor(lines)).toEqual(expected);
  });

  it.each([
    ['a method the log ends inside', [enter(1000), debug(1500)], true],
    ['a leaf', [debug(1500)], true],
    ['an empty log', [], true],
    ['a log that did not parse', [enter(1000), exit(2000)], false],
  ])('folds nothing for %s', async (_label, lines, parsed) => {
    expect(await foldsFor(lines, parsed)).toEqual([]);
  });

  it('folds nothing for a document not open as a text tab', async () => {
    setOpenTabs();
    expect(await foldsFor([enter(1000), exit(2000)])).toEqual([]);
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

      const registeredProvider = (languages.registerFoldingRangeProvider as jest.Mock).mock
        .calls[0]?.[1] as RawLogFoldingProvider;
      const tabsHandler = (window.tabGroups.onDidChangeTabs as jest.Mock).mock.calls[0]?.[0] as (
        event: unknown,
      ) => void;
      const activeEditorHandler = (window.onDidChangeActiveTextEditor as jest.Mock).mock
        .calls[0]?.[0] as (editor: unknown) => void;

      // The tab handler reads the active editor rather than taking a document.
      const fireTabChange = (doc: unknown) => {
        window.activeTextEditor = { document: doc } as typeof window.activeTextEditor;
        tabsHandler({});
      };
      const fireActiveEditor = (doc: unknown) => activeEditorHandler({ document: doc });
      const fired = jest.fn();
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
      mockGetApexLog.mockResolvedValueOnce(createMockApexLog());

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
