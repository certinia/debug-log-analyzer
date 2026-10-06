/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { LogEvent } from '@apexdevtools/apex-log-parser';
import { Uri, workspace } from 'vscode';

import {
  createMockApexLog,
  asContext,
  createMockContext,
  createMockDisplay,
  createMockLogEvent,
} from '../../__tests__/helpers/test-builders.js';
import { LogEventCache } from '../LogEventCache.js';

// Mock apex-log-parser
vi.mock('@apexdevtools/apex-log-parser', () => ({
  parse: vi.fn(),
}));

import { parse } from '@apexdevtools/apex-log-parser';

// The file-I/O layer is deliberately not mocked out. Stubbing the whole module is
// what let getApexLog read through a service that throws until another extension
// initialises it, with the failure swallowed by its own catch.
const mockReadFile = workspace.fs.readFile as Mock;
const mockParse = parse as Mock;

function readsAnyLog(): void {
  mockReadFile.mockResolvedValue(new TextEncoder().encode('content'));
  mockParse.mockImplementation(() => createMockApexLog());
}

const display = createMockDisplay();
const open = (name: string) => LogEventCache.getApexLog(Uri.file(`/test/${name}.log`), display);

describe('LogEventCache', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockParse.mockReset();
    (display.output as Mock).mockClear();
    // @ts-expect-error - accessing private static for testing
    LogEventCache.cache.clear();
    // @ts-expect-error - accessing private static for testing
    LogEventCache.reported.clear();
  });

  describe('getApexLog', () => {
    it('reads and parses a log once, then serves it from the cache', async () => {
      readsAnyLog();

      const first = await open('file');
      const second = await open('file');

      expect(second).toBe(first);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it('evicts the least recently used log past 10 entries', async () => {
      readsAnyLog();
      for (let i = 0; i < 10; i++) {
        await open(`file${i}`);
      }
      // Touching file0 makes file1 the oldest.
      await open('file0');
      await open('file10');
      mockReadFile.mockClear();

      await open('file0');
      expect(mockReadFile).not.toHaveBeenCalled();
      await open('file1');
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['the read', () => mockReadFile.mockRejectedValueOnce(new Error('File not found'))],
      [
        'the parse',
        () => {
          mockReadFile.mockResolvedValueOnce(new TextEncoder().encode('invalid'));
          mockParse.mockImplementationOnce(() => {
            throw new Error('Parse error');
          });
        },
      ],
    ])('returns null when %s fails', async (_label, fail) => {
      fail();
      expect(await open('broken')).toBeNull();
    });

    it('reports why a log could not be read, once until it is reopened', async () => {
      mockReadFile.mockRejectedValue(new Error('File not found'));

      await open('nonexistent');
      await open('nonexistent');
      expect(display.output).toHaveBeenCalledTimes(1);
      expect(display.output).toHaveBeenCalledWith(
        'Could not read file:///test/nonexistent.log: File not found',
        true,
      );

      LogEventCache.clearCache('file:///test/nonexistent.log');
      await open('nonexistent');
      expect(display.output).toHaveBeenCalledTimes(2);
    });
  });

  describe('findEventByTimestamp', () => {
    const at = (timestamp: number, exitStamp: number | null, children: LogEvent[] = []) =>
      createMockLogEvent({ timestamp, exitStamp, children });

    describe('among siblings', () => {
      const span = at(1000, 3000);
      const zeroLength = at(1000, 1000);
      const noExit = at(1000, null);
      const first = at(1000, 2000);
      const second = at(3000, 4000);
      const third = at(5000, 6000);
      const gapped = [at(1000, 2000), at(4000, 5000)];
      const hundred = Array.from({ length: 100 }, (_, i) => at(i * 100, i * 100 + 50));

      it.each([
        ['its start', [span], 1000, span],
        ['inside it', [span], 2000, span],
        ['its end', [span], 3000, span],
        ['a zero-length event', [zeroLength], 1000, zeroLength],
        ['an event with no exit, at its start', [noExit], 1000, noExit],
        ['the middle of three', [first, second, third], 3500, second],
        ['one of a hundred', hundred, 5025, hundred[50]],
      ])('finds the event at %s', (_label, children, timestamp, event) => {
        const apexLog = createMockApexLog({ children });
        expect(LogEventCache.findEventByTimestamp(apexLog, timestamp)).toEqual({
          event,
          depth: 0,
        });
      });

      it.each([
        ['before every event', [span], 500],
        ['after every event', [first], 3000],
        ['past an event with no exit', [noExit], 1001],
        ['in a gap between siblings', gapped, 3000],
        ['in an empty log', [], 1000],
      ])('finds nothing %s', (_label, children, timestamp) => {
        const apexLog = createMockApexLog({ children });
        expect(LogEventCache.findEventByTimestamp(apexLog, timestamp)).toBeNull();
      });
    });

    describe('nested', () => {
      const child = at(1200, 1800);
      const withChild = at(1000, 2000, [child]);
      const grandchild = at(1300, 1700);
      const withGrandchild = at(1000, 2000, [at(1200, 1800, [grandchild])]);
      const earlyChild = at(1000, 2000, [at(1300, 1400)]);
      const middle = at(1400, 1600);
      const withThree = at(1000, 2000, [at(1100, 1300), middle, at(1700, 1900)]);

      it.each([
        ['a child', withChild, child, 1],
        ['a grandchild', withGrandchild, grandchild, 2],
        ['the parent outside its child', earlyChild, earlyChild, 0],
        ['the middle of three children', withThree, middle, 1],
      ])('finds %s at its depth', (_label, root, event, depth) => {
        const apexLog = createMockApexLog({ children: [root] });
        expect(LogEventCache.findEventByTimestamp(apexLog, 1500)).toEqual({ event, depth });
      });
    });
  });

  it('clears one log and keeps the others', async () => {
    readsAnyLog();
    await open('file1');
    await open('file2');
    mockReadFile.mockClear();

    LogEventCache.clearCache('file:///test/file1.log');

    await open('file2');
    expect(mockReadFile).not.toHaveBeenCalled();
    await open('file1');
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  // A log saved as .trace or pasted into an untitled buffer never gets the apexlog
  // language, but the decoration provider still parses it, so it must still clear.
  it.each(['apexlog', 'javascript'])(
    'clears a log when its %s document closes',
    async (languageId) => {
      readsAnyLog();
      await open('file');
      let onClose: ((doc: { languageId: string; uri: Uri }) => void) | undefined;
      (workspace.onDidCloseTextDocument as Mock).mockImplementationOnce((callback) => {
        onClose = callback as typeof onClose;
        return { dispose: vi.fn() };
      });
      const mockContext = createMockContext();

      LogEventCache.apply(asContext(mockContext));
      onClose?.({ languageId, uri: Uri.file('/test/file.log') });
      mockReadFile.mockClear();
      await open('file');

      expect(mockContext.context.subscriptions).toHaveLength(1);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    },
  );
});
