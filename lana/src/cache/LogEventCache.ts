/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { workspace, type Uri } from 'vscode';

import { parse, type ApexLog } from '@apexdevtools/apex-log-parser';

import type { Context } from '../Context.js';
import { tryCatchAsync } from '../tryCatch.js';
import { eventLines, type EventLines } from './eventLines.js';

/** The sink an unreadable log is reported to. `Display` satisfies it. */
export interface LogReporter {
  output(message: string, showChannel?: boolean): void;
}

/** The lines of an open document, as `TextDocument` gives them. */
export interface LogDocument {
  readonly version: number;
  readonly lineCount: number;
  lineAt(line: number): { readonly text: string };
}

export class LogEventCache {
  private static readonly MAX_CACHE_SIZE = 10;
  /** By uri: the parse, held from its start so callers that ask while it runs share it. */
  private static readonly cache = new Map<string, Promise<ApexLog | null>>();
  private static readonly reported = new Set<string>();
  private static readonly lines = new WeakMap<ApexLog, { version: number; lines: EventLines }>();

  static getApexLog(uri: Uri, reporter: LogReporter): Promise<ApexLog | null> {
    const key = uri.toString();
    const cached = LogEventCache.cache.get(key);
    if (cached) {
      // Move to end (most recently used)
      LogEventCache.cache.delete(key);
      LogEventCache.cache.set(key, cached);
      return cached;
    }

    // Evict oldest if at capacity
    if (LogEventCache.cache.size >= LogEventCache.MAX_CACHE_SIZE) {
      const oldest = LogEventCache.cache.keys().next().value;
      if (oldest) {
        LogEventCache.cache.delete(oldest);
      }
    }

    const parsing = LogEventCache.read(uri, reporter);
    LogEventCache.cache.set(key, parsing);
    void parsing.then((apexLog) => {
      // A failure is not kept, so the next ask reads the file again.
      if (!apexLog && LogEventCache.cache.get(key) === parsing) {
        LogEventCache.cache.delete(key);
      }
    });
    return parsing;
  }

  private static async read(uri: Uri, reporter: LogReporter): Promise<ApexLog | null> {
    const key = uri.toString();
    // Bytes, not text: the parser reads them without a decoded copy of the whole log.
    const [apexLog, error] = await tryCatchAsync(async () =>
      parse(await workspace.fs.readFile(uri)),
    );
    if (error) {
      // Folding, symbols and decorations each retry this as the user types, so report a given
      // log once until it closes.
      if (!LogEventCache.reported.has(key)) {
        LogEventCache.reported.add(key);
        reporter.output(`Could not read ${key}: ${error.message}`, true);
      }
      return null;
    }
    return apexLog;
  }

  /** Each event's lines in `document`, the parse of it; held until the document changes. */
  static linesOf(apexLog: ApexLog, document: LogDocument): EventLines {
    const held = LogEventCache.lines.get(apexLog);
    if (held && held.version === document.version) {
      return held.lines;
    }
    const lines = eventLines(apexLog, document.lineCount, (line) => document.lineAt(line).text);
    LogEventCache.lines.set(apexLog, { version: document.version, lines });
    return lines;
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
}
