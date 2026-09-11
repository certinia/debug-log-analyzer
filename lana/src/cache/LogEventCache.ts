/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { workspace, type Uri } from 'vscode';

import { parse, type ApexLog, type LogEvent } from 'apex-log-parser';

import type { Context } from '../Context.js';
import type { Display } from '../display/Display.js';
import { readFileText } from '../fs/workspaceFs.js';
import { tryCatchAsync } from '../tryCatch.js';

export interface EventSearchResult {
  event: LogEvent;
  depth: number;
}

export class LogEventCache {
  private static readonly MAX_CACHE_SIZE = 10;
  private static cache = new Map<string, ApexLog>();
  private static display: Display | null = null;

  static async getApexLog(uri: Uri): Promise<ApexLog | null> {
    const key = uri.toString();
    const cached = LogEventCache.cache.get(key);
    if (cached) {
      // Move to end (most recently used)
      LogEventCache.cache.delete(key);
      LogEventCache.cache.set(key, cached);
      return cached;
    }

    const [apexLog, error] = await tryCatchAsync(async () => parse(await readFileText(uri)));
    if (error) {
      // Folding, symbols and decorations each call this as the user types, so a toast would spam.
      LogEventCache.display?.output(`Could not read ${key}: ${error.message}`);
      return null;
    }

    // Evict oldest if at capacity
    if (LogEventCache.cache.size >= LogEventCache.MAX_CACHE_SIZE) {
      const oldest = LogEventCache.cache.keys().next().value;
      if (oldest) {
        LogEventCache.cache.delete(oldest);
      }
    }

    LogEventCache.cache.set(key, apexLog);
    return apexLog;
  }

  static findEventByTimestamp(apexLog: ApexLog, timestamp: number): EventSearchResult | null {
    return LogEventCache.searchEvents(apexLog.children, timestamp, 0);
  }

  static clearCache(uriString: string): void {
    LogEventCache.cache.delete(uriString);
  }

  static apply(context: Context): void {
    LogEventCache.display = context.display;

    context.context.subscriptions.push(
      workspace.onDidCloseTextDocument((doc) => {
        if (doc.languageId === 'apexlog') {
          LogEventCache.clearCache(doc.uri.toString());
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
