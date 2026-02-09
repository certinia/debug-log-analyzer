/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { workspace } from 'vscode';

import {
  createMockApexLog,
  createMockContext,
  createMockLogEvent,
} from '../../__tests__/helpers/test-builders.js';
import { LogEventCache } from '../LogEventCache.js';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

// Mock apex-log-parser
jest.mock('apex-log-parser', () => ({
  parse: jest.fn(),
}));

import { parse } from 'apex-log-parser';
import { readFile } from 'fs/promises';

const mockReadFile = readFile as jest.Mock;
const mockParse = parse as jest.Mock;

describe('LogEventCache', () => {
  beforeEach(() => {
    // Clear the cache between tests by accessing private static
    // @ts-expect-error - accessing private static for testing
    LogEventCache.cache.clear();
  });

  describe('getApexLog', () => {
    describe('cache behavior', () => {
      it('should return cached ApexLog on subsequent calls', async () => {
        const mockApexLog = createMockApexLog({ size: 1000 });
        mockReadFile.mockResolvedValueOnce('log content');
        mockParse.mockReturnValueOnce(mockApexLog);

        // First call - should read and parse
        const result1 = await LogEventCache.getApexLog('/test/file.log');
        expect(result1).toBe(mockApexLog);
        expect(mockReadFile).toHaveBeenCalledTimes(1);

        // Second call - should return cached
        const result2 = await LogEventCache.getApexLog('/test/file.log');
        expect(result2).toBe(mockApexLog);
        expect(mockReadFile).toHaveBeenCalledTimes(1); // Still 1
      });

      it('should move accessed item to end (most recently used)', async () => {
        const log1 = createMockApexLog({ size: 100 });
        const log2 = createMockApexLog({ size: 200 });

        mockReadFile.mockResolvedValueOnce('content1').mockResolvedValueOnce('content2');
        mockParse.mockReturnValueOnce(log1).mockReturnValueOnce(log2);

        await LogEventCache.getApexLog('/test/file1.log');
        await LogEventCache.getApexLog('/test/file2.log');

        // Access file1 again - should move to end
        await LogEventCache.getApexLog('/test/file1.log');

        // @ts-expect-error - accessing private static for testing
        const keys = Array.from(LogEventCache.cache.keys());
        expect(keys).toEqual(['/test/file2.log', '/test/file1.log']);
      });

      it('should evict oldest entry when cache reaches MAX_CACHE_SIZE', async () => {
        // Create 11 logs to trigger eviction (MAX_CACHE_SIZE is 10)
        for (let i = 0; i < 11; i++) {
          const mockLog = createMockApexLog({ size: i * 100 });
          mockReadFile.mockResolvedValueOnce(`content${i}`);
          mockParse.mockReturnValueOnce(mockLog);

          await LogEventCache.getApexLog(`/test/file${i}.log`);
        }

        // @ts-expect-error - accessing private static for testing
        const cacheSize = LogEventCache.cache.size;
        expect(cacheSize).toBe(10);

        // First file should be evicted
        // @ts-expect-error - accessing private static for testing
        const hasFirst = LogEventCache.cache.has('/test/file0.log');
        expect(hasFirst).toBe(false);

        // Last file should exist
        // @ts-expect-error - accessing private static for testing
        const hasLast = LogEventCache.cache.has('/test/file10.log');
        expect(hasLast).toBe(true);
      });

      it('should return null when file read fails', async () => {
        mockReadFile.mockRejectedValueOnce(new Error('File not found'));

        const result = await LogEventCache.getApexLog('/test/nonexistent.log');

        expect(result).toBeNull();
      });

      it('should return null when parse fails', async () => {
        mockReadFile.mockResolvedValueOnce('invalid content');
        mockParse.mockImplementationOnce(() => {
          throw new Error('Parse error');
        });

        const result = await LogEventCache.getApexLog('/test/invalid.log');

        expect(result).toBeNull();
      });
    });
  });

  describe('findEventByTimestamp', () => {
    describe('binary search', () => {
      it('should find event with exact timestamp match', () => {
        const event = createMockLogEvent({ timestamp: 1000, exitStamp: 2000 });
        const apexLog = createMockApexLog({ children: [event] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 1000);

        expect(result).toEqual({ event, depth: 0 });
      });

      it('should find event when timestamp is within range', () => {
        const event = createMockLogEvent({ timestamp: 1000, exitStamp: 3000 });
        const apexLog = createMockApexLog({ children: [event] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 2000);

        expect(result).toEqual({ event, depth: 0 });
      });

      it('should find event at end of range', () => {
        const event = createMockLogEvent({ timestamp: 1000, exitStamp: 3000 });
        const apexLog = createMockApexLog({ children: [event] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 3000);

        expect(result).toEqual({ event, depth: 0 });
      });

      it('should return null when timestamp is before all events', () => {
        const event = createMockLogEvent({ timestamp: 1000, exitStamp: 2000 });
        const apexLog = createMockApexLog({ children: [event] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 500);

        expect(result).toBeNull();
      });

      it('should return null when timestamp is after all events', () => {
        const event = createMockLogEvent({ timestamp: 1000, exitStamp: 2000 });
        const apexLog = createMockApexLog({ children: [event] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 3000);

        expect(result).toBeNull();
      });

      it('should find correct event among multiple events', () => {
        const event1 = createMockLogEvent({ timestamp: 1000, exitStamp: 2000 });
        const event2 = createMockLogEvent({ timestamp: 3000, exitStamp: 4000 });
        const event3 = createMockLogEvent({ timestamp: 5000, exitStamp: 6000 });
        const apexLog = createMockApexLog({ children: [event1, event2, event3] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 3500);

        expect(result).toEqual({ event: event2, depth: 0 });
      });

      it('should find event in gap between sibling events', () => {
        const event1 = createMockLogEvent({ timestamp: 1000, exitStamp: 2000 });
        const event2 = createMockLogEvent({ timestamp: 4000, exitStamp: 5000 });
        const apexLog = createMockApexLog({ children: [event1, event2] });

        // Timestamp 3000 is between event1 end and event2 start
        const result = LogEventCache.findEventByTimestamp(apexLog, 3000);

        expect(result).toBeNull();
      });
    });

    describe('nested events', () => {
      it('should search children and find nested event', () => {
        const childEvent = createMockLogEvent({ timestamp: 1200, exitStamp: 1800 });
        const parentEvent = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 2000,
          children: [childEvent],
        });
        const apexLog = createMockApexLog({ children: [parentEvent] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 1500);

        expect(result).toEqual({ event: childEvent, depth: 1 });
      });

      it('should find deeply nested event at correct depth', () => {
        const grandchild = createMockLogEvent({ timestamp: 1300, exitStamp: 1700 });
        const child = createMockLogEvent({
          timestamp: 1200,
          exitStamp: 1800,
          children: [grandchild],
        });
        const parent = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 2000,
          children: [child],
        });
        const apexLog = createMockApexLog({ children: [parent] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 1500);

        expect(result).toEqual({ event: grandchild, depth: 2 });
      });

      it('should return parent when timestamp is outside child ranges', () => {
        const child = createMockLogEvent({ timestamp: 1300, exitStamp: 1400 });
        const parent = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 2000,
          children: [child],
        });
        const apexLog = createMockApexLog({ children: [parent] });

        // 1500 is after child ends but before parent ends
        const result = LogEventCache.findEventByTimestamp(apexLog, 1500);

        expect(result).toEqual({ event: parent, depth: 0 });
      });

      it('should handle events with multiple children at same level', () => {
        const child1 = createMockLogEvent({ timestamp: 1100, exitStamp: 1300 });
        const child2 = createMockLogEvent({ timestamp: 1400, exitStamp: 1600 });
        const child3 = createMockLogEvent({ timestamp: 1700, exitStamp: 1900 });
        const parent = createMockLogEvent({
          timestamp: 1000,
          exitStamp: 2000,
          children: [child1, child2, child3],
        });
        const apexLog = createMockApexLog({ children: [parent] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 1500);

        expect(result).toEqual({ event: child2, depth: 1 });
      });
    });

    describe('edge cases', () => {
      it('should return null for empty events array', () => {
        const apexLog = createMockApexLog({ children: [] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 1000);

        expect(result).toBeNull();
      });

      it('should handle single event in array', () => {
        const event = createMockLogEvent({ timestamp: 1000, exitStamp: 2000 });
        const apexLog = createMockApexLog({ children: [event] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 1500);

        expect(result).toEqual({ event, depth: 0 });
      });

      it('should handle event with null exitStamp (use timestamp as end)', () => {
        const event = createMockLogEvent({ timestamp: 1000, exitStamp: null });
        const apexLog = createMockApexLog({ children: [event] });

        // Should only match exact timestamp when exitStamp is null
        const exactResult = LogEventCache.findEventByTimestamp(apexLog, 1000);
        expect(exactResult).toEqual({ event, depth: 0 });

        const afterResult = LogEventCache.findEventByTimestamp(apexLog, 1001);
        expect(afterResult).toBeNull();
      });

      it('should handle event where exitStamp equals timestamp', () => {
        const event = createMockLogEvent({ timestamp: 1000, exitStamp: 1000 });
        const apexLog = createMockApexLog({ children: [event] });

        const result = LogEventCache.findEventByTimestamp(apexLog, 1000);

        expect(result).toEqual({ event, depth: 0 });
      });

      it('should handle large number of events', () => {
        const events = [];
        for (let i = 0; i < 100; i++) {
          events.push(
            createMockLogEvent({
              timestamp: i * 100,
              exitStamp: i * 100 + 50,
            }),
          );
        }
        const apexLog = createMockApexLog({ children: events });

        // Search for event in the middle
        const result = LogEventCache.findEventByTimestamp(apexLog, 5025);

        expect(result?.event.timestamp).toBe(5000);
        expect(result?.depth).toBe(0);
      });
    });
  });

  describe('clearCache', () => {
    it('should remove specific entry from cache', async () => {
      const mockApexLog = createMockApexLog();
      mockReadFile.mockResolvedValueOnce('content');
      mockParse.mockReturnValueOnce(mockApexLog);

      await LogEventCache.getApexLog('/test/file.log');

      // @ts-expect-error - accessing private static for testing
      expect(LogEventCache.cache.has('/test/file.log')).toBe(true);

      LogEventCache.clearCache('/test/file.log');

      // @ts-expect-error - accessing private static for testing
      expect(LogEventCache.cache.has('/test/file.log')).toBe(false);
    });

    it('should not affect other cached entries', async () => {
      const log1 = createMockApexLog({ size: 100 });
      const log2 = createMockApexLog({ size: 200 });

      mockReadFile.mockResolvedValueOnce('content1').mockResolvedValueOnce('content2');
      mockParse.mockReturnValueOnce(log1).mockReturnValueOnce(log2);

      await LogEventCache.getApexLog('/test/file1.log');
      await LogEventCache.getApexLog('/test/file2.log');

      LogEventCache.clearCache('/test/file1.log');

      // @ts-expect-error - accessing private static for testing
      expect(LogEventCache.cache.has('/test/file1.log')).toBe(false);
      // @ts-expect-error - accessing private static for testing
      expect(LogEventCache.cache.has('/test/file2.log')).toBe(true);
    });

    it('should handle clearing non-existent entry gracefully', () => {
      expect(() => {
        LogEventCache.clearCache('/test/nonexistent.log');
      }).not.toThrow();
    });
  });

  describe('apply', () => {
    it('should register onDidCloseTextDocument listener', () => {
      const mockContext = createMockContext();

      LogEventCache.apply(mockContext as unknown as import('../../Context.js').Context);

      expect(workspace.onDidCloseTextDocument).toHaveBeenCalledTimes(1);
      expect(mockContext.context.subscriptions.length).toBe(1);
    });

    it('should clear cache when apexlog document is closed', async () => {
      // Setup cache
      const mockApexLog = createMockApexLog();
      mockReadFile.mockResolvedValueOnce('content');
      mockParse.mockReturnValueOnce(mockApexLog);
      await LogEventCache.getApexLog('/test/file.log');

      // Capture the callback
      let closeCallback: ((doc: { languageId: string; uri: { fsPath: string } }) => void) | null =
        null;
      (workspace.onDidCloseTextDocument as jest.Mock).mockImplementationOnce((cb) => {
        closeCallback = cb;
        return { dispose: jest.fn() };
      });

      const mockContext = createMockContext();
      LogEventCache.apply(mockContext as unknown as import('../../Context.js').Context);

      // Simulate closing an apexlog document
      closeCallback!({
        languageId: 'apexlog',
        uri: { fsPath: '/test/file.log' },
      });

      // @ts-expect-error - accessing private static for testing
      expect(LogEventCache.cache.has('/test/file.log')).toBe(false);
    });

    it('should not clear cache when non-apexlog document is closed', async () => {
      // Setup cache
      const mockApexLog = createMockApexLog();
      mockReadFile.mockResolvedValueOnce('content');
      mockParse.mockReturnValueOnce(mockApexLog);
      await LogEventCache.getApexLog('/test/file.log');

      // Capture the callback
      let closeCallback: ((doc: { languageId: string; uri: { fsPath: string } }) => void) | null =
        null;
      (workspace.onDidCloseTextDocument as jest.Mock).mockImplementationOnce((cb) => {
        closeCallback = cb;
        return { dispose: jest.fn() };
      });

      const mockContext = createMockContext();
      LogEventCache.apply(mockContext as unknown as import('../../Context.js').Context);

      // Simulate closing a non-apexlog document
      closeCallback!({
        languageId: 'javascript',
        uri: { fsPath: '/test/file.log' },
      });

      // @ts-expect-error - accessing private static for testing
      expect(LogEventCache.cache.has('/test/file.log')).toBe(true);
    });
  });
});
