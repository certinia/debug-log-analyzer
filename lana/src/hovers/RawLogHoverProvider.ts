/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  Hover,
  languages,
  MarkdownString,
  type HoverProvider,
  type Position,
  type ProviderResult,
  type TextDocument,
} from 'vscode';

import { LogEventCache } from '../cache/LogEventCache.js';
import { Context } from '../Context.js';
import { buildMetricParts, TIMESTAMP_REGEX } from '../log-utils.js';

class RawLogHoverProvider implements HoverProvider {
  provideHover(document: TextDocument, position: Position): ProviderResult<Hover> {
    const line = document.lineAt(position.line);
    const match = line.text.match(TIMESTAMP_REGEX);

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

    const metricParts = result ? buildMetricParts(result.event) : [];

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
