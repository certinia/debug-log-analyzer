/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import {
  MarkdownString,
  Range,
  window,
  type DecorationOptions,
  type ExtensionContext,
  type TextEditor,
  type TextEditorSelectionChangeEvent,
} from 'vscode';

import type { LogEvent } from 'apex-log-parser';

import { Context } from '../Context.js';
import { LogEventCache } from '../cache/LogEventCache.js';

// Regex to extract nanosecond timestamp from log line
// Format: "HH:MM:SS.d (nanoseconds)|EVENT_TYPE"
const timestampRegex = /^\d{2}:\d{2}:\d{2}\.\d+\s*\((\d+)\)\|/;

// Decoration type for ghost text on cursor line - no isWholeLine so hover only triggers at end
const cursorLineDecorationType = window.createTextEditorDecorationType({
  after: {
    margin: '0 0 0 2em',
    color: '#888888',
  },
});

export class RawLogLineDecoration {
  private static instance: RawLogLineDecoration | null = null;
  private context: ExtensionContext;
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  private constructor(context: ExtensionContext) {
    this.context = context;
  }

  static apply(context: Context): void {
    if (RawLogLineDecoration.instance) {
      return;
    }

    RawLogLineDecoration.instance = new RawLogLineDecoration(context.context);
    RawLogLineDecoration.instance.register();
  }

  private register(): void {
    this.context.subscriptions.push(
      window.onDidChangeTextEditorSelection((event) => {
        this.handleSelectionChange(event);
      }),
    );

    this.context.subscriptions.push(
      window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.clearDecorations(editor);
        }
      }),
    );
  }

  private handleSelectionChange(event: TextEditorSelectionChangeEvent): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(() => {
      this.updateDecoration(event.textEditor);
    }, 100);
  }

  private async updateDecoration(editor: TextEditor): Promise<void> {
    const document = editor.document;

    if (document.languageId !== 'apexlog') {
      this.clearDecorations(editor);
      return;
    }

    const selection = editor.selection;
    const line = document.lineAt(selection.active.line);
    const match = line.text.match(timestampRegex);

    if (!match?.[1]) {
      this.clearDecorations(editor);
      return;
    }

    const timestamp = parseInt(match[1], 10);
    const filePath = document.uri.fsPath;

    const apexLog = await LogEventCache.getApexLog(filePath);
    if (!apexLog) {
      this.clearDecorations(editor);
      return;
    }

    const result = LogEventCache.findEventByTimestamp(apexLog, timestamp);
    if (!result) {
      this.clearDecorations(editor);
      return;
    }

    const { event } = result;
    const durationText = this.formatDurationText(event.duration.total, event.duration.self);

    // Use empty range at end of line so hover only triggers near the ghost text
    const endOfLine = line.range.end;
    const decoration: DecorationOptions = {
      range: new Range(endOfLine, endOfLine),
      hoverMessage: this.buildHoverMessage(event, timestamp, filePath),
      renderOptions: {
        after: {
          contentText: durationText,
        },
      },
    };

    editor.setDecorations(cursorLineDecorationType, [decoration]);
  }

  private clearDecorations(editor: TextEditor): void {
    editor.setDecorations(cursorLineDecorationType, []);
  }

  private buildHoverMessage(event: LogEvent, timestamp: number, filePath: string): MarkdownString {
    const args = encodeURIComponent(JSON.stringify({ timestamp, filePath }));
    const commandUri = `command:lana.showInLogAnalysis?${args}`;

    const metricParts: string[] = [];

    // Duration with optional self time
    const totalDuration = this.formatDuration(event.duration.total);
    if (event.duration.self !== event.duration.total) {
      const selfDuration = this.formatDuration(event.duration.self);
      metricParts.push(`**${totalDuration}** (self: ${selfDuration})`);
    } else {
      metricParts.push(`**${totalDuration}**`);
    }

    // SOQL with self count
    if (event.soqlCount.total > 0) {
      const selfPart = event.soqlCount.self > 0 ? ` (self: ${event.soqlCount.self})` : '';
      metricParts.push(`${event.soqlCount.total} SOQL${selfPart}`);
    }

    // SOQL rows
    if (event.soqlRowCount.total > 0) {
      metricParts.push(`${event.soqlRowCount.total} rows`);
    }

    // DML with self count
    if (event.dmlCount.total > 0) {
      const selfPart = event.dmlCount.self > 0 ? ` (self: ${event.dmlCount.self})` : '';
      metricParts.push(`${event.dmlCount.total} DML${selfPart}`);
    }

    // DML rows
    if (event.dmlRowCount.total > 0) {
      metricParts.push(`${event.dmlRowCount.total} DML rows`);
    }

    // Exceptions
    if (event.totalThrownCount > 0) {
      metricParts.push(`⚠️ ${event.totalThrownCount} thrown`);
    }

    const parts: string[] = [];
    if (metricParts.length > 0) {
      parts.push(metricParts.join(' · '));
      parts.push('---');
    }
    parts.push(`[Show in Log Analysis](${commandUri})`);

    const markdown = new MarkdownString(parts.join('\n\n'), true);
    markdown.isTrusted = true;

    return markdown;
  }

  private formatDurationText(totalNs: number, selfNs: number): string {
    const total = this.formatDuration(totalNs);

    if (selfNs !== totalNs && selfNs > 0) {
      const self = this.formatDuration(selfNs);
      return `${total} (self: ${self})`;
    }

    return total;
  }

  private formatDuration(nanoseconds: number): string {
    const milliseconds = nanoseconds / 1_000_000;
    const seconds = milliseconds / 1000;

    if (seconds >= 60) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
    } else if (seconds >= 1) {
      return `${seconds.toFixed(2)}s`;
    } else {
      return `${milliseconds.toFixed(2)}ms`;
    }
  }
}
