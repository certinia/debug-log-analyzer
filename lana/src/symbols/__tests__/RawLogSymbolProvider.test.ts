/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { SymbolKind, languages } from 'vscode';

import {
  createMockApexLog,
  createMockContext,
  createMockLogEvent,
} from '../../__tests__/helpers/test-builders.js';
import { createMockTextDocument } from '../../__tests__/mocks/vscode.js';
import { LogEventCache } from '../../cache/LogEventCache.js';
import { RawLogSymbolProvider } from '../RawLogSymbolProvider.js';

jest.mock('../../cache/LogEventCache.js', () => ({
  LogEventCache: {
    getApexLog: jest.fn(),
  },
}));

const mockGetApexLog = LogEventCache.getApexLog as jest.Mock;

describe('RawLogSymbolProvider', () => {
  let provider: RawLogSymbolProvider;

  beforeEach(() => {
    provider = new RawLogSymbolProvider();
    mockGetApexLog.mockReset();
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
  });

  describe('apply', () => {
    it('registers a document symbol provider for apexlog', () => {
      const mockContext = createMockContext();

      RawLogSymbolProvider.apply(mockContext as unknown as import('../../Context.js').Context);

      expect(languages.registerDocumentSymbolProvider).toHaveBeenCalledTimes(1);
      expect(languages.registerDocumentSymbolProvider).toHaveBeenCalledWith(
        [{ scheme: 'file', language: 'apexlog' }],
        expect.any(RawLogSymbolProvider),
      );
    });
  });
});
