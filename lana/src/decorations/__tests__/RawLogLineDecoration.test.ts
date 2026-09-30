/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { window, type TextDocument, type TextEditor } from 'vscode';

import {
  createMockApexLog,
  asContext,
  createMockContext,
  createMockLogEvent,
} from '../../__tests__/helpers/test-builders.js';
import {
  Position,
  Selection,
  TabInputText,
  Uri,
  createMockTextDocument,
  setOpenTabs,
} from '../../__tests__/mocks/vscode.js';
import { LogEventCache } from '../../cache/LogEventCache.js';
import { RawLogLineDecoration } from '../RawLogLineDecoration.js';

jest.mock('../../cache/LogEventCache.js', () => ({
  LogEventCache: {
    getApexLog: jest.fn(),
    findEventByTimestamp: jest.fn(),
  },
}));

const mockGetApexLog = LogEventCache.getApexLog as jest.Mock;
const mockFindEvent = LogEventCache.findEventByTimestamp as jest.Mock;
const mockOnSelectionChange = window.onDidChangeTextEditorSelection as jest.Mock;

const LOG_URI = '/test/file.log';
const EXECUTION_STARTED = '09:45:31.888 (1000)|EXECUTION_STARTED';

function makeEditor(document: TextDocument, line = 0): TextEditor {
  const at = new Position(line, 0);
  return {
    document,
    selection: new Selection(at, at),
    setDecorations: jest.fn(),
  } as unknown as TextEditor;
}

/** Fires the registered selection listener and lets the debounce elapse. */
async function selectIn(editor: TextEditor): Promise<void> {
  const listener = mockOnSelectionChange.mock.calls[0]?.[0] as (event: {
    textEditor: TextEditor;
  }) => void;
  listener({ textEditor: editor });
  jest.advanceTimersByTime(100);
  await Promise.resolve();
  await Promise.resolve();
}

describe('RawLogLineDecoration', () => {
  let mockContext: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    jest.useFakeTimers();
    // The class keeps one instance for the life of the extension host.
    (RawLogLineDecoration as unknown as { instance: unknown }).instance = null;
    setOpenTabs(new TabInputText(Uri.file(LOG_URI)));
    mockContext = createMockContext();
    RawLogLineDecoration.apply(asContext(mockContext));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('apply', () => {
    it('registers a selection listener', () => {
      expect(mockOnSelectionChange).toHaveBeenCalledTimes(1);
    });

    it('registers once, however many times it is applied', () => {
      RawLogLineDecoration.apply(asContext(mockContext));
      RawLogLineDecoration.apply(asContext(mockContext));

      expect(mockOnSelectionChange).toHaveBeenCalledTimes(1);
    });
  });

  describe('decorating the cursor line', () => {
    it('shows the total duration of the event on that line', async () => {
      const document = createMockTextDocument({ uri: LOG_URI, lines: [EXECUTION_STARTED] });
      const editor = makeEditor(document);
      mockGetApexLog.mockResolvedValue(createMockApexLog({}));
      mockFindEvent.mockReturnValue({
        event: createMockLogEvent({ duration: { total: 2_000_000, self: 2_000_000 } }),
        depth: 0,
      });

      await selectIn(editor);

      const decorations = (editor.setDecorations as jest.Mock).mock.calls[0]?.[1] as {
        renderOptions: { after: { contentText: string } };
      }[];
      expect(decorations).toHaveLength(1);
      expect(decorations[0]?.renderOptions.after.contentText).toBe('2.00ms');
    });

    it('names the self time when it differs from the total', async () => {
      const document = createMockTextDocument({ uri: LOG_URI, lines: [EXECUTION_STARTED] });
      const editor = makeEditor(document);
      mockGetApexLog.mockResolvedValue(createMockApexLog({}));
      mockFindEvent.mockReturnValue({
        event: createMockLogEvent({ duration: { total: 5_000_000, self: 1_000_000 } }),
        depth: 0,
      });

      await selectIn(editor);

      const decorations = (editor.setDecorations as jest.Mock).mock.calls[0]?.[1] as {
        renderOptions: { after: { contentText: string } };
      }[];
      expect(decorations[0]?.renderOptions.after.contentText).toBe('5.00ms (self: 1.00ms)');
    });

    it('reads the log through the reporter it was given', async () => {
      const document = createMockTextDocument({ uri: LOG_URI, lines: [EXECUTION_STARTED] });
      mockGetApexLog.mockResolvedValue(null);

      await selectIn(makeEditor(document));

      expect(mockGetApexLog).toHaveBeenCalledWith(document.uri, mockContext.display);
    });
  });

  describe('clearing the decoration', () => {
    const expectCleared = (editor: TextEditor) => {
      const calls = (editor.setDecorations as jest.Mock).mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toEqual([]);
    };

    it('clears when the document is not an Apex log', async () => {
      const document = createMockTextDocument({ uri: LOG_URI, lines: ['just some text'] });
      const editor = makeEditor(document);

      await selectIn(editor);

      expectCleared(editor);
      expect(mockGetApexLog).not.toHaveBeenCalled();
    });

    it('clears when the line carries no timestamp', async () => {
      const document = createMockTextDocument({
        uri: LOG_URI,
        lines: [EXECUTION_STARTED, 'a wrapped continuation line'],
      });
      const editor = makeEditor(document, 1);

      await selectIn(editor);

      expectCleared(editor);
      expect(mockGetApexLog).not.toHaveBeenCalled();
    });

    it('clears when the log is not open as a text tab', async () => {
      setOpenTabs();
      const document = createMockTextDocument({ uri: LOG_URI, lines: [EXECUTION_STARTED] });
      const editor = makeEditor(document);

      await selectIn(editor);

      expectCleared(editor);
      expect(mockGetApexLog).not.toHaveBeenCalled();
    });

    it('clears when the log cannot be read', async () => {
      const document = createMockTextDocument({ uri: LOG_URI, lines: [EXECUTION_STARTED] });
      const editor = makeEditor(document);
      mockGetApexLog.mockResolvedValue(null);

      await selectIn(editor);

      expectCleared(editor);
    });

    it('clears when no event covers the timestamp', async () => {
      const document = createMockTextDocument({ uri: LOG_URI, lines: [EXECUTION_STARTED] });
      const editor = makeEditor(document);
      mockGetApexLog.mockResolvedValue(createMockApexLog({}));
      mockFindEvent.mockReturnValue(null);

      await selectIn(editor);

      expectCleared(editor);
    });
  });

  describe('debounce', () => {
    it('does nothing until the cursor settles', () => {
      const document = createMockTextDocument({ uri: LOG_URI, lines: [EXECUTION_STARTED] });
      const editor = makeEditor(document);
      const listener = mockOnSelectionChange.mock.calls[0]?.[0] as (event: {
        textEditor: TextEditor;
      }) => void;

      listener({ textEditor: editor });
      jest.advanceTimersByTime(99);

      expect(editor.setDecorations).not.toHaveBeenCalled();
    });

    it('keeps only the last selection when the cursor moves repeatedly', async () => {
      const document = createMockTextDocument({ uri: LOG_URI, lines: [EXECUTION_STARTED] });
      const first = makeEditor(document);
      const second = makeEditor(document);
      mockGetApexLog.mockResolvedValue(null);
      const listener = mockOnSelectionChange.mock.calls[0]?.[0] as (event: {
        textEditor: TextEditor;
      }) => void;

      listener({ textEditor: first });
      jest.advanceTimersByTime(50);
      listener({ textEditor: second });
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(first.setDecorations).not.toHaveBeenCalled();
      expect(second.setDecorations).toHaveBeenCalled();
    });
  });
});
