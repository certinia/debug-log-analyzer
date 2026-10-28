/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { SymbolKind, languages } from 'vscode';

import {
  createMockDisplay,
  asContext,
  createMockContext,
  logLine,
  parseLines,
} from '../../__tests__/helpers/test-builders.js';
import {
  TabInputText,
  TabInputTextDiff,
  Uri,
  createMockTextDocument,
  setOpenTabs,
  window,
} from '../../__tests__/mocks/vscode.js';
import { LogEventCache } from '../../cache/LogEventCache.js';
import { RawLogSymbolProvider } from '../RawLogSymbolProvider.js';

// Only the parse is mocked: the lines of each event are read as the provider reads them.
jest.mock('../../cache/LogEventCache.js', () => {
  const actual = jest.requireActual<typeof import('../../cache/LogEventCache.js')>(
    '../../cache/LogEventCache.js',
  );
  actual.LogEventCache.getApexLog = jest.fn();
  return actual;
});

const mockGetApexLog = LogEventCache.getApexLog as jest.Mock;
const APEX_LOG_LINE = '09:45:31.888 (1000)|EXECUTION_STARTED';

const enter = (ns: number, name: string) => logLine(ns, `METHOD_ENTRY|[1]|01p|${name}`);
const exit = (ns: number, name: string) => logLine(ns, `METHOD_EXIT|[1]|${name}`);

describe('RawLogSymbolProvider', () => {
  let provider: RawLogSymbolProvider;
  let display: ReturnType<typeof createMockDisplay>;

  beforeEach(() => {
    display = createMockDisplay();
    provider = new RawLogSymbolProvider(display);
    mockGetApexLog.mockReset();
    // The provider only works for a document the user has open as a text tab.
    setOpenTabs(new TabInputText(Uri.file('/test/file.log')));
  });

  async function symbolsFor(lines: string[]) {
    const doc = createMockTextDocument({ lines, uri: '/test/file.log' });
    mockGetApexLog.mockResolvedValueOnce(await parseLines(lines));
    return provider.provideDocumentSymbols(doc, {} as never);
  }

  describe('provideDocumentSymbols', () => {
    it('builds a symbol spanning the event, named by the parser label not the raw line', async () => {
      const symbols = await symbolsFor([
        enter(1000, 'FooController.doWork()'),
        logLine(1500, 'STATEMENT_EXECUTE|[2]'),
        exit(2000, 'FooController.doWork()'),
      ]);

      expect(symbols.length).toBe(1);
      expect(symbols[0]?.name).toBe('FooController.doWork()');
      expect(symbols[0]?.kind).toBe(SymbolKind.Method);
      expect(symbols[0]?.range.start.line).toBe(0);
      expect(symbols[0]?.range.end.line).toBe(2);
    });

    it('falls back to the event type when the parser label is empty', async () => {
      const symbols = await symbolsFor([
        logLine(1000, 'EXECUTION_STARTED'),
        logLine(2000, 'EXECUTION_FINISHED'),
      ]);

      expect(symbols[0]?.name).toBe('EXECUTION_STARTED');
    });

    it('nests child events under their parent', async () => {
      const symbols = await symbolsFor([
        logLine(1000, 'CODE_UNIT_STARTED|[EXTERNAL]|01q|Entry'),
        enter(1500, 'A.a()'),
        exit(2000, 'A.a()'),
        logLine(3000, 'CODE_UNIT_FINISHED|Entry'),
      ]);

      expect(symbols.length).toBe(1);
      expect(symbols[0]?.children.length).toBe(1);
      expect(symbols[0]?.children[0]?.range.start.line).toBe(1);
      expect(symbols[0]?.children[0]?.range.end.line).toBe(2);
    });

    it('lifts descendants when an event has no foldable range', async () => {
      // The log ends inside the parent, so it has no exit line; its child surfaces at top level.
      const symbols = await symbolsFor([
        enter(1000, 'A.a()'),
        enter(1500, 'A.b()'),
        exit(2000, 'A.b()'),
      ]);

      expect(symbols.length).toBe(1);
      expect(symbols[0]?.range.start.line).toBe(1);
    });

    it('returns an empty array when the log fails to parse', async () => {
      const doc = createMockTextDocument({ lines: [], uri: '/test/file.log' });
      mockGetApexLog.mockResolvedValueOnce(null);

      const symbols = await provider.provideDocumentSymbols(doc, {} as never);

      expect(symbols).toEqual([]);
    });

    it.each([
      ['the tab model does not list the document', []],
      [
        'the document is only shown as a diff side',
        [new TabInputTextDiff(Uri.parse('git:/test/file.log'), Uri.file('/test/file.log'))],
      ],
    ])('returns no symbols, without parsing, when %s', async (_label, tabs) => {
      setOpenTabs(...tabs);
      const doc = createMockTextDocument({ lines: [APEX_LOG_LINE], uri: '/test/file.log' });

      expect(await provider.provideDocumentSymbols(doc, {} as never)).toEqual([]);
      expect(mockGetApexLog).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    const applyProvider = () => {
      const mockContext = createMockContext();
      RawLogSymbolProvider.apply(asContext(mockContext));
      const registered = (languages.registerDocumentSymbolProvider as jest.Mock).mock.calls.at(
        -1,
      )?.[1] as RawLogSymbolProvider | undefined;
      if (!registered) {
        throw new Error('no document symbol provider registered');
      }
      return { registered, display: mockContext.display };
    };

    const fireTabChange = () => {
      const handler = (window.tabGroups.onDidChangeTabs as jest.Mock).mock.calls[0]?.[0] as (
        event: unknown,
      ) => void;
      handler(undefined);
    };

    it('registers a provider for apexlog that reports through the context display', async () => {
      const { registered, display } = applyProvider();
      mockGetApexLog.mockResolvedValue(null);

      expect(languages.registerDocumentSymbolProvider).toHaveBeenCalledTimes(1);
      expect(languages.registerDocumentSymbolProvider).toHaveBeenCalledWith(
        [{ language: 'apexlog' }],
        expect.any(RawLogSymbolProvider),
      );

      await registered.provideDocumentSymbols(
        createMockTextDocument({ lines: [APEX_LOG_LINE], uri: '/test/file.log' }),
        {} as never,
      );

      expect(mockGetApexLog).toHaveBeenCalledWith(expect.anything(), display);
    });

    it.each([
      [
        'asks VS Code again once the tab model lists it as text',
        new TabInputText(Uri.file('/test/file.log')),
        2,
      ],
      [
        'stays put while it is still only a diff side',
        new TabInputTextDiff(Uri.parse('git:/test/file.log'), Uri.file('/test/file.log')),
        1,
      ],
    ])('for a rejected log, %s', async (_label, tabAfter, registrations) => {
      const doc = createMockTextDocument({ lines: [APEX_LOG_LINE], uri: '/test/file.log' });
      setOpenTabs();
      const { registered } = applyProvider();

      await registered.provideDocumentSymbols(doc, {} as never);

      setOpenTabs(tabAfter);
      window.activeTextEditor = { document: doc };
      fireTabChange();

      expect(languages.registerDocumentSymbolProvider).toHaveBeenCalledTimes(registrations);
    });

    it('does not re-register a log no request was rejected for', () => {
      const doc = createMockTextDocument({ lines: [APEX_LOG_LINE], uri: '/test/file.log' });
      applyProvider();

      window.activeTextEditor = { document: doc };
      fireTabChange();

      expect(languages.registerDocumentSymbolProvider).toHaveBeenCalledTimes(1);
    });
  });
});
