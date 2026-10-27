/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { window, type TextDocument, type TextEditor } from 'vscode';

import {
  asContext,
  createMockContext,
  logLine,
  parseLines,
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

// Only the parse is mocked: the lines of each event are read as the decoration reads them.
jest.mock('../../cache/LogEventCache.js', () => {
  const actual = jest.requireActual<typeof import('../../cache/LogEventCache.js')>(
    '../../cache/LogEventCache.js',
  );
  actual.LogEventCache.getApexLog = jest.fn();
  return actual;
});

const mockGetApexLog = LogEventCache.getApexLog as jest.Mock;
const mockOnSelectionChange = window.onDidChangeTextEditorSelection as jest.Mock;

const LOG_URI = '/test/file.log';
const EXECUTION_STARTED = '09:45:31.888 (1000)|EXECUTION_STARTED';
const enter = (ns: number, name: string) => logLine(ns, `METHOD_ENTRY|[1]|01p|${name}`);
const exit = (ns: number, name: string) => logLine(ns, `METHOD_EXIT|[1]|${name}`);

/** A 5 ms method, id 2, holding a 4 ms one, id 3; the first line makes it an Apex log. */
const NESTED = [
  EXECUTION_STARTED,
  enter(1_000, 'A.a()'),
  enter(1_001_000, 'A.b()'),
  exit(5_001_000, 'A.b()'),
  exit(5_001_000, 'A.a()'),
];

/** The decorations set on `editor`, after the cursor settles on `line` of `lines`. */
async function decorate(lines: string[], line: number) {
  const document = createMockTextDocument({ uri: LOG_URI, lines });
  const editor = makeEditor(document, line);
  mockGetApexLog.mockResolvedValue(await parseLines(lines));
  await selectIn(editor);
  return (editor.setDecorations as jest.Mock).mock.calls[0]?.[1] as {
    renderOptions: { after: { contentText: string } };
    hoverMessage: { value: string };
  }[];
}

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

  it('registers one selection listener, however many times it is applied', () => {
    RawLogLineDecoration.apply(asContext(mockContext));
    RawLogLineDecoration.apply(asContext(mockContext));

    expect(mockOnSelectionChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the total duration', 3, '4.00ms'],
    ['the self time when it differs from the total', 1, '5.00ms (self: 1.00ms)'],
    ['the frame its exit line closes', 4, '5.00ms (self: 1.00ms)'],
  ])('decorates the cursor line with %s', async (_label, line, expected) => {
    const decorations = await decorate(NESTED, line);

    expect(mockGetApexLog).toHaveBeenCalledWith(
      expect.objectContaining({ path: LOG_URI }),
      mockContext.display,
    );
    expect(decorations.map((d) => d.renderOptions.after.contentText)).toEqual([expected]);
  });

  it('links the event by its id, which a shared timestamp cannot name', async () => {
    const [decoration] = await decorate(NESTED, 2);

    const args = /showInLogAnalysis\?([^)\s]+)/.exec(decoration?.hoverMessage.value ?? '')?.[1];
    expect(JSON.parse(decodeURIComponent(args ?? '{}'))).toEqual({
      eventIndex: 3,
      filePath: expect.stringContaining(LOG_URI),
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

    it('clears on a line the parser made no event of', async () => {
      const lines = [EXECUTION_STARTED, logLine(1500, 'NOT_A_REAL_EVENT|x')];
      const document = createMockTextDocument({ uri: LOG_URI, lines });
      const editor = makeEditor(document, 1);
      mockGetApexLog.mockResolvedValue(await parseLines(lines));

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
