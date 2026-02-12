/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  window,
  workspace,
  type DecorationOptions,
  type ExtensionContext,
  type TextDocument,
  type TextEditor,
} from 'vscode';

import { Context } from '../Context.js';
import { APEXLOG_HEADER, isApexLogContent } from '../language/ApexLogLanguageDetector.js';
import { formatDuration, TIMESTAMP_REGEX } from '../log-utils.js';

// Pattern to find EXECUTION_STARTED line
const executionStartedRegex = /^\d{2}:\d{2}:\d{2}\.\d+\s*\((\d+)\)\|EXECUTION_STARTED/m;

// Decoration type for ghost text
const decorationType = window.createTextEditorDecorationType({
  after: {
    margin: '0 0 0 2em',
    color: '#888888',
  },
  isWholeLine: true,
});

export class LogTimingDecoration {
  private static instance: LogTimingDecoration | null = null;
  private context: ExtensionContext;

  private constructor(context: ExtensionContext) {
    this.context = context;
  }

  static apply(context: Context): void {
    if (LogTimingDecoration.instance) {
      return;
    }

    LogTimingDecoration.instance = new LogTimingDecoration(context.context);
    LogTimingDecoration.instance.register();
  }

  private register(): void {
    // NOTE: window.activeTextEditor is undefined for files 50mb or larger for performance reasons.
    // tokenization, wrapping, folding, codelens, word highlighting all get disabled.

    // Update decorations for active editor on activation
    if (window.activeTextEditor) {
      this.updateDecorations(window.activeTextEditor);
    }

    // Listen for editor changes
    this.context.subscriptions.push(
      window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateDecorations(editor);
        }
      }),
    );

    // Listen for document changes
    this.context.subscriptions.push(
      workspace.onDidChangeTextDocument((event) => {
        const editor = window.activeTextEditor;
        if (editor && event.document === editor.document) {
          this.updateDecorations(editor);
        }
      }),
    );

    // Listen for document open
    this.context.subscriptions.push(
      workspace.onDidOpenTextDocument((doc) => {
        const editor = window.activeTextEditor;
        if (editor && editor.document === doc) {
          this.updateDecorations(editor);
        }
      }),
    );
  }

  private updateDecorations(editor: TextEditor): void {
    const document = editor.document;

    if (!isApexLogContent(document)) {
      editor.setDecorations(decorationType, []);
      return;
    }

    const duration = this.calculateLogDuration(document);
    if (duration === null) {
      editor.setDecorations(decorationType, []);
      return;
    }

    const formattedDuration = formatDuration(duration);

    const startLine = this.findFirstLogLine(document);
    if (startLine === null) {
      editor.setDecorations(decorationType, []);
      return;
    }

    const line = document.lineAt(startLine);
    const decoration: DecorationOptions = {
      range: line.range,
      renderOptions: {
        after: {
          contentText: `⏱ ${formattedDuration}`,
        },
      },
    };

    editor.setDecorations(decorationType, [decoration]);
  }

  private findFirstLogLine(doc: TextDocument): number | null {
    const limit = Math.min(1000, doc.lineCount);
    for (let i = 0; i < limit; i++) {
      const text = doc.lineAt(i).text;
      if (APEXLOG_HEADER.test(text) || TIMESTAMP_REGEX.test(text)) {
        return i;
      }
    }
    return null;
  }

  private calculateLogDuration(document: TextDocument): number | null {
    const startTs = this.findTimestamp(document, false, executionStartedRegex);
    const endTs = this.findTimestamp(document, true, TIMESTAMP_REGEX);
    return startTs && endTs && endTs > startTs ? endTs - startTs : null;
  }

  private findTimestamp(doc: TextDocument, fromEnd: boolean, pattern: RegExp): number | null {
    const limit = Math.min(1000, doc.lineCount);
    const start = fromEnd ? doc.lineCount - 1 : 0;
    const step = fromEnd ? -1 : 1;

    for (let i = 0; i < limit; i++) {
      const match = doc.lineAt(start + i * step).text.match(pattern);
      if (match?.[1]) {
        return parseInt(match[1], 10);
      }
    }
    return null;
  }
}
