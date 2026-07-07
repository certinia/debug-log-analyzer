/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { FoldingRangeKind, languages, window, workspace } from 'vscode';

import {
  createMockApexLog,
  createMockContext,
  createMockLogEvent,
} from '../../__tests__/helpers/test-builders.js';
import { createMockTextDocument } from '../../__tests__/mocks/vscode.js';
import { LogEventCache } from '../../cache/LogEventCache.js';
import { RawLogFoldingProvider } from '../RawLogFoldingProvider.js';

// Mock LogEventCache
jest.mock('../../cache/LogEventCache.js', () => ({
  LogEventCache: {
    getApexLog: jest.fn(),
  },
}));

const mockGetApexLog = LogEventCache.getApexLog as jest.Mock;

describe('RawLogFoldingProvider', () => {
  let provider: RawLogFoldingProvider;

  beforeEach(() => {
    provider = new RawLogFoldingProvider();
    mockGetApexLog.mockReset();
  });

  describe('provideFoldingRanges', () => {
    describe('timestamp mapping', () => {
      it('should extract timestamps from log lines', async () => {
        const lines = [
          '09:45:31.888 (1000)|METHOD_ENTRY',
          '09:45:31.889 (2000)|STATEMENT_EXECUTE',
          '09:45:31.890 (3000)|METHOD_EXIT',
        ];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const event = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 3000,
          children: [],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges.length).toBe(1);
        expect(ranges[0]?.start).toBe(0);
        expect(ranges[0]?.end).toBe(2);
      });

      it('should handle lines without timestamps', async () => {
        const lines = [
          '09:45:31.888 (1000)|METHOD_ENTRY',
          'Some non-timestamp line',
          '09:45:31.890 (2000)|METHOD_EXIT',
        ];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const event = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 2000,
          children: [],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges.length).toBe(1);
        expect(ranges[0]?.start).toBe(0);
        expect(ranges[0]?.end).toBe(2);
      });

      it('should use first occurrence for duplicate timestamps', async () => {
        const lines = [
          '09:45:31.888 (1000)|METHOD_ENTRY',
          '09:45:31.888 (1000)|ANOTHER_EVENT',
          '09:45:31.890 (2000)|METHOD_EXIT',
        ];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const event = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 2000,
          children: [],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        // Should map to first occurrence (line 0)
        expect(ranges[0]?.start).toBe(0);
      });
    });

    describe('folding range creation', () => {
      it('should create folding range for event with exitStamp', async () => {
        const lines = [
          '09:45:31.888 (1000)|METHOD_ENTRY',
          '09:45:31.889 (1500)|STATEMENT_EXECUTE',
          '09:45:31.890 (2000)|METHOD_EXIT',
        ];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const event = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 2000,
          children: [],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges.length).toBe(1);
        expect(ranges[0]?.kind).toBe(FoldingRangeKind.Region);
      });

      it('should not create folding range when exitStamp equals timestamp', async () => {
        const lines = ['09:45:31.888 (1000)|METHOD_ENTRY'];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const event = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 1000,
          children: [],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges.length).toBe(0);
      });

      it('should not create folding range when exitStamp is null', async () => {
        const lines = ['09:45:31.888 (1000)|METHOD_ENTRY'];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const event = createMockLogEvent({
          timestamp: 1000,
          exitStamp: null,
          children: [],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges.length).toBe(0);
      });

      it('should not create folding range when end line is not after start line', async () => {
        const lines = ['09:45:31.888 (2000)|METHOD_EXIT', '09:45:31.888 (1000)|METHOD_ENTRY'];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        // Event with timestamps in reverse order in document
        const event = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 2000,
          children: [],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        // Should not create range since endLine (1) is not > startLine (0)
        // Actually timestamps map: 1000->line1, 2000->line0
        // So start=1, end=0, which is invalid
        expect(ranges.length).toBe(0);
      });
    });

    describe('nested events', () => {
      it('should create folding ranges for nested events', async () => {
        const lines = [
          '09:45:31.888 (1000)|CODE_UNIT_STARTED',
          '09:45:31.889 (1500)|METHOD_ENTRY',
          '09:45:31.890 (2000)|METHOD_EXIT',
          '09:45:31.891 (3000)|CODE_UNIT_FINISHED',
        ];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const childEvent = createMockLogEvent({
          timestamp: 1500,
          exitStamp: 2000,
          children: [],
        });
        const parentEvent = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 3000,
          children: [childEvent],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [parentEvent] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges.length).toBe(2);
        // Parent range
        expect(ranges.some((r) => r.start === 0 && r.end === 3)).toBe(true);
        // Child range
        expect(ranges.some((r) => r.start === 1 && r.end === 2)).toBe(true);
      });

      it('should handle deeply nested events', async () => {
        const lines = [
          '09:45:31.888 (1000)|LEVEL1_START',
          '09:45:31.889 (2000)|LEVEL2_START',
          '09:45:31.890 (3000)|LEVEL3_START',
          '09:45:31.891 (4000)|LEVEL3_END',
          '09:45:31.892 (5000)|LEVEL2_END',
          '09:45:31.893 (6000)|LEVEL1_END',
        ];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const level3 = createMockLogEvent({
          timestamp: 3000,
          exitStamp: 4000,
          children: [],
        });
        const level2 = createMockLogEvent({
          timestamp: 2000,
          exitStamp: 5000,
          children: [level3],
        });
        const level1 = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 6000,
          children: [level2],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [level1] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges.length).toBe(3);
      });

      it('should handle sibling events', async () => {
        const lines = [
          '09:45:31.888 (1000)|METHOD1_ENTRY',
          '09:45:31.889 (2000)|METHOD1_EXIT',
          '09:45:31.890 (3000)|METHOD2_ENTRY',
          '09:45:31.891 (4000)|METHOD2_EXIT',
        ];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const method1 = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 2000,
          children: [],
        });
        const method2 = createMockLogEvent({
          timestamp: 3000,
          exitStamp: 4000,
          children: [],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [method1, method2] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges.length).toBe(2);
        expect(ranges.some((r) => r.start === 0 && r.end === 1)).toBe(true);
        expect(ranges.some((r) => r.start === 2 && r.end === 3)).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should return empty array when apexLog is null', async () => {
        const doc = createMockTextDocument({ lines: [], uri: '/test/file.log' });
        mockGetApexLog.mockResolvedValueOnce(null);

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges).toEqual([]);
      });

      it('should return empty array for empty log', async () => {
        const doc = createMockTextDocument({ lines: [], uri: '/test/file.log' });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges).toEqual([]);
      });

      it('should handle events with timestamps not found in document', async () => {
        const lines = ['09:45:31.888 (1000)|METHOD_ENTRY'];
        const doc = createMockTextDocument({ lines, uri: '/test/file.log' });

        const event = createMockLogEvent({
          timestamp: 9999, // Not in document
          exitStamp: 10000,
          children: [],
        });
        mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [event] }));

        const ranges = await provider.provideFoldingRanges(doc, {} as never);

        expect(ranges).toEqual([]);
      });
    });
  });

  describe('apply', () => {
    it('should register folding range provider for apexlog', () => {
      const mockContext = createMockContext();

      RawLogFoldingProvider.apply(mockContext as unknown as import('../../Context.js').Context);

      expect(languages.registerFoldingRangeProvider).toHaveBeenCalledTimes(1);
      expect(languages.registerFoldingRangeProvider).toHaveBeenCalledWith(
        [{ scheme: 'file', language: 'apexlog' }],
        expect.any(RawLogFoldingProvider),
      );
    });

    it('should register an onDidOpenTextDocument listener', () => {
      const mockContext = createMockContext();

      RawLogFoldingProvider.apply(mockContext as unknown as import('../../Context.js').Context);

      expect(workspace.onDidOpenTextDocument).toHaveBeenCalledTimes(1);
    });

    it('should add disposables to context subscriptions', () => {
      const mockContext = createMockContext();

      RawLogFoldingProvider.apply(mockContext as unknown as import('../../Context.js').Context);

      // emitter + folding provider registration + open listener + active-editor listener
      expect(mockContext.context.subscriptions.length).toBe(4);
    });
  });

  describe('signals VS Code when a log is parsed', () => {
    // An EXECUTION_STARTED line makes isApexLogContent() return true.
    const apexLogLines = ['16:35:06.2 (2706460)|EXECUTION_STARTED'];

    function applyAndCapture() {
      const mockContext = createMockContext();
      RawLogFoldingProvider.apply(mockContext as unknown as import('../../Context.js').Context);

      const registeredProvider = (languages.registerFoldingRangeProvider as jest.Mock).mock
        .calls[0]?.[1] as RawLogFoldingProvider;
      const openHandler = (workspace.onDidOpenTextDocument as jest.Mock).mock.calls[0]?.[0] as (
        doc: unknown,
      ) => void;
      const activeEditorHandler = (window.onDidChangeActiveTextEditor as jest.Mock).mock
        .calls[0]?.[0] as (editor: unknown) => void;

      return { registeredProvider, openHandler, activeEditorHandler };
    }

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('warms the cache and fires onDidChangeFoldingRanges when an apex log opens', async () => {
      const { registeredProvider, openHandler } = applyAndCapture();
      const fired = jest.fn();
      registeredProvider.onDidChangeFoldingRanges?.(fired);

      mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [] }));
      const doc = createMockTextDocument({ lines: apexLogLines, uri: '/test/file.log' });
      openHandler(doc);
      await flush();

      expect(mockGetApexLog).toHaveBeenCalledWith('/test/file.log');
      expect(fired).toHaveBeenCalledTimes(1);
    });

    it('warms the cache and fires when an apex log editor becomes active (reopen)', async () => {
      const { registeredProvider, activeEditorHandler } = applyAndCapture();
      const fired = jest.fn();
      registeredProvider.onDidChangeFoldingRanges?.(fired);

      mockGetApexLog.mockResolvedValueOnce(createMockApexLog({ children: [] }));
      const doc = createMockTextDocument({ lines: apexLogLines, uri: '/test/file.log' });
      activeEditorHandler({ document: doc });
      await flush();

      expect(mockGetApexLog).toHaveBeenCalledWith('/test/file.log');
      expect(fired).toHaveBeenCalledTimes(1);
    });

    it('does not warm or signal for a non-apex-log document', async () => {
      const { registeredProvider, openHandler } = applyAndCapture();
      const fired = jest.fn();
      registeredProvider.onDidChangeFoldingRanges?.(fired);

      const doc = createMockTextDocument({ lines: ['just some text'], uri: '/test/notes.log' });
      openHandler(doc);
      await flush();

      expect(mockGetApexLog).not.toHaveBeenCalled();
      expect(fired).not.toHaveBeenCalled();
    });

    it('does not fire when the log fails to parse', async () => {
      const { registeredProvider, openHandler } = applyAndCapture();
      const fired = jest.fn();
      registeredProvider.onDidChangeFoldingRanges?.(fired);

      mockGetApexLog.mockResolvedValueOnce(null);
      const doc = createMockTextDocument({ lines: apexLogLines, uri: '/test/file.log' });
      openHandler(doc);
      await flush();

      expect(mockGetApexLog).toHaveBeenCalledWith('/test/file.log');
      expect(fired).not.toHaveBeenCalled();
    });
  });
});
