/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { readFile } from 'fs/promises';
import { workspace } from 'vscode';

import { parse, type ApexLog, type LogEvent } from 'apex-log-parser';

import { Context } from '../Context.js';

export interface EventSearchResult {
  event: LogEvent;
  depth: number;
}

export class LogEventCache {
  private static cache = new Map<string, ApexLog>();

  static async getApexLog(filePath: string): Promise<ApexLog | null> {
    const cached = LogEventCache.cache.get(filePath);
    if (cached) {
      return cached;
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const apexLog = parse(content);
      LogEventCache.cache.set(filePath, apexLog);
      return apexLog;
    } catch {
      return null;
    }
  }

  static findEventByTimestamp(apexLog: ApexLog, timestamp: number): EventSearchResult | null {
    return LogEventCache.searchEvents(apexLog.children, timestamp, 0);
  }

  static clearCache(filePath: string): void {
    LogEventCache.cache.delete(filePath);
  }

  static apply(context: Context): void {
    context.context.subscriptions.push(
      workspace.onDidCloseTextDocument((doc) => {
        if (doc.languageId === 'apexlog') {
          LogEventCache.clearCache(doc.uri.fsPath);
        }
      }),
    );
  }

  private static searchEvents(
    events: LogEvent[],
    timestamp: number,
    depth: number,
  ): EventSearchResult | null {
    let start = 0;
    let end = events.length - 1;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      const event = events[mid];
      if (!event) {
        break;
      }

      const endTime = event.exitStamp ?? event.timestamp;

      if (timestamp === event.timestamp) {
        return { event, depth };
      }

      if (timestamp >= event.timestamp && timestamp <= endTime) {
        const child =
          event.children.length > 0
            ? LogEventCache.searchEvents(event.children, timestamp, depth + 1)
            : null;
        return child ?? { event, depth };
      }

      if (timestamp > endTime) {
        start = mid + 1;
      } else {
        end = mid - 1;
      }
    }

    return null;
  }
}
