/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
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

import type { ApexEvent } from '@apexdevtools/apex-log-parser';

import type { Context } from '../Context.js';
import { LogEventCache, type LogReporter } from '../cache/LogEventCache.js';
import { isOpenAsTextTab } from '../editor/TabState.js';
import { isApexLogContent } from '../language/ApexLogLanguageDetector.js';
import { buildMetricParts, formatDuration, TIMESTAMP_REGEX } from '../log-utils.js';

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
  private readonly reporter: LogReporter;
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;

  private constructor(context: ExtensionContext, reporter: LogReporter) {
    this.context = context;
    this.reporter = reporter;
  }

  static apply(context: Context): void {
    if (RawLogLineDecoration.instance) {
      return;
    }

    RawLogLineDecoration.instance = new RawLogLineDecoration(context.context, context.display);
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
      void this.updateDecoration(event.textEditor);
    }, 100);
  }

  private async updateDecoration(editor: TextEditor): Promise<void> {
    const document = editor.document;

    if (!isApexLogContent(document)) {
      this.clearDecorations(editor);
      return;
    }

    const selection = editor.selection;
    const line = document.lineAt(selection.active.line);
    if (!TIMESTAMP_REGEX.test(line.text)) {
      this.clearDecorations(editor);
      return;
    }

    const filePath = document.uri.toString();

    if (!isOpenAsTextTab(document.uri)) {
      this.clearDecorations(editor);
      return;
    }

    const apexLog = await LogEventCache.getApexLog(document.uri, this.reporter);
    if (!apexLog) {
      this.clearDecorations(editor);
      return;
    }

    // The event the line starts, or the frame it closes.
    const { startLine, exitLine } = LogEventCache.linesOf(apexLog, document);
    const startId = startLine.indexOf(line.lineNumber);
    const event = apexLog.event(startId > 0 ? startId : exitLine.indexOf(line.lineNumber));
    if (!event) {
      this.clearDecorations(editor);
      return;
    }
    const durationText = this.formatDurationText(event.duration.total, event.duration.self);

    // Use empty range at end of line so hover only triggers near the ghost text
    const endOfLine = line.range.end;
    const decoration: DecorationOptions = {
      range: new Range(endOfLine, endOfLine),
      hoverMessage: this.buildHoverMessage(event, filePath),
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

  private buildHoverMessage(event: ApexEvent, filePath: string): MarkdownString {
    const args = encodeURIComponent(JSON.stringify({ eventIndex: event.id, filePath }));
    const commandUri = `command:lana.showInLogAnalysis?${args}`;

    const metricParts = buildMetricParts(event);

    const parts: string[] = [];
    if (metricParts.length > 0) {
      parts.push(metricParts.join(' · '));
      parts.push('---');
    }
    parts.push(`[Show in Log Analysis](${commandUri} "Show in Log Analysis")`);

    const markdown = new MarkdownString(parts.join('\n\n'), true);
    markdown.isTrusted = true;

    return markdown;
  }

  private formatDurationText(totalNs: number, selfNs: number): string {
    const total = formatDuration(totalNs);

    if (selfNs !== totalNs && selfNs > 0) {
      const self = formatDuration(selfNs);
      return `${total} (self: ${self})`;
    }

    return total;
  }
}
