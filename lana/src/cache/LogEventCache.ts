/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { workspace, type Uri } from 'vscode';

import { parse, type ApexLog, type LogEvent } from 'apex-log-parser';

import type { Context } from '../Context.js';
import { readFileText } from '../fs/workspaceFs.js';
import { tryCatchAsync } from '../tryCatch.js';

/** The sink an unreadable log is reported to. `Display` satisfies it. */
export interface LogReporter {
  output(message: string, showChannel?: boolean): void;
}

export interface EventSearchResult {
  event: LogEvent;
  depth: number;
}

export class LogEventCache {
  private static readonly MAX_CACHE_SIZE = 10;
  private static readonly cache = new Map<string, ApexLog>();
  private static readonly reported = new Set<string>();

  static async getApexLog(uri: Uri, reporter: LogReporter): Promise<ApexLog | null> {
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
      // Folding, symbols and decorations each retry this as the user types, and a failure is
      // never cached, so report a given log once until it closes.
      if (!LogEventCache.reported.has(key)) {
        LogEventCache.reported.add(key);
        reporter.output(`Could not read ${key}: ${error.message}`, true);
      }
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
    LogEventCache.reported.delete(uriString);
  }

  static apply(context: Context): void {
    context.context.subscriptions.push(
      // Not gated on languageId: the decoration provider sniffs content, so it reaches
      // logs saved under any extension, and those would never clear.
      workspace.onDidCloseTextDocument((doc) => {
        LogEventCache.clearCache(doc.uri.toString());
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
