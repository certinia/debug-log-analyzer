/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { Uri, workspace } from 'vscode';

import {
  createMockApexLog,
  asContext,
  createMockContext,
  createMockDisplay,
} from '../../__tests__/helpers/test-builders.js';
import { LogEventCache } from '../LogEventCache.js';

// Mock apex-log-parser
jest.mock('@apexdevtools/apex-log-parser', () => ({
  ...jest.requireActual<object>('@apexdevtools/apex-log-parser'),
  parse: jest.fn(),
}));

import { parse } from '@apexdevtools/apex-log-parser';

// The file-I/O layer is deliberately not mocked out. Stubbing the whole module is
// what let getApexLog read through a service that throws until another extension
// initialises it, with the failure swallowed by its own catch.
const mockReadFile = workspace.fs.readFile as jest.Mock;
const mockParse = parse as jest.Mock;

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
    (display.output as jest.Mock).mockClear();
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

    // On open, folding, symbols and the decoration all ask before the first parse ends.
    it('reads a log once when several callers ask while it is still being parsed', async () => {
      readsAnyLog();

      const [first, second, third] = await Promise.all([open('file'), open('file'), open('file')]);

      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
    });

    it('reads a log again after a failed read, rather than keeping the failure', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('File not found'));
      expect(await open('flaky')).toBeNull();

      readsAnyLog();
      expect(await open('flaky')).not.toBeNull();
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

    it('returns null when the parse fails', async () => {
      mockReadFile.mockResolvedValueOnce(new TextEncoder().encode('invalid'));
      mockParse.mockImplementationOnce(() => {
        throw new Error('Parse error');
      });
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

  describe('linesOf', () => {
    const HELLO = '09:18:22.6 (100)|USER_DEBUG|[1]|DEBUG|hello';
    const doc = (version: number, lines = [HELLO]) => ({
      version,
      lineCount: lines.length,
      lineAt: jest.fn((line: number) => ({ text: lines[line]! })),
    });

    it('reads a document once per version', async () => {
      const { parse: realParse } = jest.requireActual<{
        parse: typeof parse;
      }>('@apexdevtools/apex-log-parser');
      const apexLog = await realParse(HELLO);
      const first = doc(1);

      const lines = LogEventCache.linesOf(apexLog, first);
      expect(LogEventCache.linesOf(apexLog, first)).toBe(lines);
      expect(first.lineAt).toHaveBeenCalledTimes(1);
      // An edit gives the document a new version, so its lines are read again; reused, hello stays on line 0.
      const edited = LogEventCache.linesOf(apexLog, doc(2, ['an inserted line', HELLO]));
      expect([...edited.start]).toEqual([-1, 1]);
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
      (workspace.onDidCloseTextDocument as jest.Mock).mockImplementationOnce((callback) => {
        onClose = callback as typeof onClose;
        return { dispose: jest.fn() };
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
