/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  Hover,
  MarkdownString,
  languages,
  type HoverProvider,
  type Position,
  type ProviderResult,
  type TextDocument,
} from 'vscode';

import { LogEventCache } from '../cache/LogEventCache.js';
import { Context } from '../Context.js';

// Regex to extract nanosecond timestamp from log line
// Format: "HH:MM:SS.d (nanoseconds)|EVENT_TYPE"
const timestampRegex = /^\d{2}:\d{2}:\d{2}\.\d+\s*\((\d+)\)\|/;

class RawLogHoverProvider implements HoverProvider {
  provideHover(document: TextDocument, position: Position): ProviderResult<Hover> {
    const line = document.lineAt(position.line);
    const match = line.text.match(timestampRegex);

    if (!match?.[1]) {
      return null;
    }

    const timestamp = parseInt(match[1], 10);
    return this.buildHover(document.uri.fsPath, timestamp);
  }

  private async buildHover(filePath: string, timestamp: number): Promise<Hover> {
    const args = encodeURIComponent(JSON.stringify({ timestamp, filePath }));
    const commandUri = `command:lana.showInLogAnalysis?${args}`;

    const apexLog = await LogEventCache.getApexLog(filePath);
    const result = apexLog ? LogEventCache.findEventByTimestamp(apexLog, timestamp) : null;

    const metricParts: string[] = [];

    if (result) {
      const { event } = result;

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
    }

    const parts: string[] = [];
    if (metricParts.length > 0) {
      parts.push(metricParts.join(' · '));
      parts.push('---');
    }
    parts.push(`[Show in Log Analysis](${commandUri})`);

    const markdown = new MarkdownString(parts.join('\n\n'), true);
    markdown.isTrusted = true;

    return new Hover(markdown);
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

  static apply(context: Context): void {
    const docSelector = [{ scheme: 'file', language: 'apexlog' }];

    const hoverProviderDisposable = languages.registerHoverProvider(
      docSelector,
      new RawLogHoverProvider(),
    );

    context.context.subscriptions.push(hoverProviderDisposable);
  }
}

export { RawLogHoverProvider };
