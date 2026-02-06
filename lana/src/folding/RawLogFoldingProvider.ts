/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import {
  FoldingRange,
  FoldingRangeKind,
  languages,
  type FoldingContext,
  type FoldingRangeProvider,
  type TextDocument,
} from 'vscode';

import type { LogEvent } from 'apex-log-parser';

import { Context } from '../Context.js';
import { LogEventCache } from '../cache/LogEventCache.js';
import { TIMESTAMP_REGEX } from '../log-utils.js';

class RawLogFoldingProvider implements FoldingRangeProvider {
  async provideFoldingRanges(
    document: TextDocument,
    _context: FoldingContext,
  ): Promise<FoldingRange[]> {
    const filePath = document.uri.fsPath;
    const apexLog = await LogEventCache.getApexLog(filePath);

    if (!apexLog) {
      return [];
    }

    const timestampToLine = this.buildTimestampMap(document);
    const ranges: FoldingRange[] = [];
    this.collectFoldingRanges(apexLog.children, timestampToLine, ranges);

    return ranges;
  }

  private buildTimestampMap(document: TextDocument): Map<number, number> {
    const map = new Map<number, number>();

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const match = line.text.match(TIMESTAMP_REGEX);
      if (match?.[1]) {
        const timestamp = parseInt(match[1], 10);
        if (!map.has(timestamp)) {
          map.set(timestamp, i);
        }
      }
    }

    return map;
  }

  private collectFoldingRanges(
    events: LogEvent[],
    timestampToLine: Map<number, number>,
    ranges: FoldingRange[],
  ): void {
    for (const event of events) {
      if (event.exitStamp !== null && event.exitStamp !== event.timestamp) {
        const startLine = timestampToLine.get(event.timestamp);
        const endLine = timestampToLine.get(event.exitStamp);

        if (startLine !== undefined && endLine !== undefined && endLine > startLine) {
          ranges.push(new FoldingRange(startLine, endLine, FoldingRangeKind.Region));
        }
      }

      if (event.children.length > 0) {
        this.collectFoldingRanges(event.children, timestampToLine, ranges);
      }
    }
  }

  static apply(context: Context): void {
    const docSelector = [{ scheme: 'file', language: 'apexlog' }];

    const disposable = languages.registerFoldingRangeProvider(
      docSelector,
      new RawLogFoldingProvider(),
    );

    context.context.subscriptions.push(disposable);
  }
}

export { RawLogFoldingProvider };
