/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { SymbolKind, languages } from 'vscode';

import {
  createMockDisplay,
  createMockApexLog,
  asContext,
  createMockContext,
  createMockLogEvent,
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

vi.mock('../../cache/LogEventCache.js', () => ({
  LogEventCache: {
    getApexLog: vi.fn(),
  },
}));

const mockGetApexLog = LogEventCache.getApexLog as Mock;
const APEX_LOG_LINE = '09:45:31.888 (1000)|EXECUTION_STARTED';

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

  describe('provideDocumentSymbols', () => {
    it('builds a symbol spanning the event, named by the parser label not the raw line', async () => {
      const lines = [
        '09:45:31.888 (1000)|METHOD_ENTRY|[1]|FooController.doWork',
        '09:45:31.889 (1500)|STATEMENT_EXECUTE',
        '09:45:31.890 (2000)|METHOD_EXIT',
      ];
      const doc = createMockTextDocument({ lines, uri: '/test/file.log' });
      const event = createMockLogEvent({
        timestamp: 1000,
        exitStamp: 2000,
        text: 'FooController.doWork',
        children: [],
      });
      mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

      const symbols = await provider.provideDocumentSymbols(doc, {} as never);

      expect(symbols.length).toBe(1);
      expect(symbols[0]?.name).toBe('FooController.doWork');
      expect(symbols[0]?.kind).toBe(SymbolKind.Method);
      expect(symbols[0]?.range.start.line).toBe(0);
      expect(symbols[0]?.range.end.line).toBe(2);
    });

    it('falls back to the event type when the parser label is empty', async () => {
      const lines = [
        '09:45:31.888 (1000)|CODE_UNIT_STARTED',
        '09:45:31.890 (2000)|CODE_UNIT_FINISHED',
      ];
      const doc = createMockTextDocument({ lines, uri: '/test/file.log' });
      const event = createMockLogEvent({
        timestamp: 1000,
        exitStamp: 2000,
        text: '',
        type: 'CODE_UNIT_STARTED',
        children: [],
      });
      mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

      const symbols = await provider.provideDocumentSymbols(doc, {} as never);

      expect(symbols[0]?.name).toBe('CODE_UNIT_STARTED');
    });

    it('nests child events under their parent', async () => {
      const lines = [
        '09:45:31.888 (1000)|CODE_UNIT_STARTED',
        '09:45:31.889 (1500)|METHOD_ENTRY',
        '09:45:31.890 (2000)|METHOD_EXIT',
        '09:45:31.891 (3000)|CODE_UNIT_FINISHED',
      ];
      const doc = createMockTextDocument({ lines, uri: '/test/file.log' });
      const child = createMockLogEvent({ timestamp: 1500, exitStamp: 2000, children: [] });
      const parent = createMockLogEvent({ timestamp: 1000, exitStamp: 3000, children: [child] });
      mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [parent] }));

      const symbols = await provider.provideDocumentSymbols(doc, {} as never);

      expect(symbols.length).toBe(1);
      expect(symbols[0]?.children.length).toBe(1);
      expect(symbols[0]?.children[0]?.range.start.line).toBe(1);
      expect(symbols[0]?.children[0]?.range.end.line).toBe(2);
    });

    it('lifts descendants when an event has no foldable range', async () => {
      const lines = [
        '09:45:31.888 (1000)|EXECUTION_STARTED',
        '09:45:31.889 (1500)|METHOD_ENTRY',
        '09:45:31.890 (2000)|METHOD_EXIT',
      ];
      const doc = createMockTextDocument({ lines, uri: '/test/file.log' });
      // Parent has no exitStamp -> not foldable; its child should surface at top level.
      const child = createMockLogEvent({ timestamp: 1500, exitStamp: 2000, children: [] });
      const parent = createMockLogEvent({ timestamp: 1000, exitStamp: null, children: [child] });
      mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [parent] }));

      const symbols = await provider.provideDocumentSymbols(doc, {} as never);

      expect(symbols.length).toBe(1);
      expect(symbols[0]?.range.start.line).toBe(1);
    });

    it('returns an empty array when the log fails to parse', async () => {
      const doc = createMockTextDocument({ lines: [], uri: '/test/file.log' });
      mockGetApexLog.mockResolvedValueOnce(null);

      const symbols = await provider.provideDocumentSymbols(doc, {} as never);

      expect(symbols).toEqual([]);
    });

    it('omits events whose timestamps are not in the document', async () => {
      const lines = ['09:45:31.888 (1000)|METHOD_ENTRY'];
      const doc = createMockTextDocument({ lines, uri: '/test/file.log' });
      const event = createMockLogEvent({ timestamp: 9999, exitStamp: 10000, children: [] });
      mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

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
      const registered = (languages.registerDocumentSymbolProvider as Mock).mock.calls.at(
        -1,
      )?.[1] as RawLogSymbolProvider | undefined;
      if (!registered) {
        throw new Error('no document symbol provider registered');
      }
      return { registered, display: mockContext.display };
    };

    const fireTabChange = () => {
      const handler = (window.tabGroups.onDidChangeTabs as Mock).mock.calls[0]?.[0] as (
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
