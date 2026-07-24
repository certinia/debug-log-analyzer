/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  EventEmitter,
  FoldingRange,
  FoldingRangeKind,
  languages,
  window,
  workspace,
  type FoldingContext,
  type FoldingRangeProvider,
  type TextDocument,
} from 'vscode';

import type { LogEvent } from 'apex-log-parser';

import type { Context } from '../Context.js';
import { LogEventCache } from '../cache/LogEventCache.js';
import { isApexLogContent } from '../language/ApexLogLanguageDetector.js';
import { TIMESTAMP_REGEX } from '../log-utils.js';

class RawLogFoldingProvider implements FoldingRangeProvider {
  private readonly changeEmitter = new EventEmitter<void>();
  readonly onDidChangeFoldingRanges = this.changeEmitter.event;

  async provideFoldingRanges(
    document: TextDocument,
    _context: FoldingContext,
  ): Promise<FoldingRange[]> {
    const uriString = document.uri.toString();
    const apexLog = await LogEventCache.getApexLog(uriString);

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

  /**
   * Warm the parse cache for an Apex log document and signal VS Code to re-request
   * folding ranges once the data is ready. Without this, a slow first parse loses the
   * race against VS Code's initial folding request and folding never appears until an
   * unrelated action forces a re-evaluation.
   */
  private warmAndSignal(document: TextDocument): void {
    // Support both desktop (file) and web (vscode-vfs, memfs) schemes
    const supportedSchemes = ['file', 'vscode-vfs', 'memfs'];
    if (!supportedSchemes.includes(document.uri.scheme) || !isApexLogContent(document)) {
      return;
    }

    void LogEventCache.getApexLog(document.uri.toString()).then((apexLog) => {
      if (apexLog) {
        this.changeEmitter.fire();
      }
    });
  }

  static apply(context: Context): void {
    const docSelector = [{ scheme: 'file', language: 'apexlog' }];
    const provider = new RawLogFoldingProvider();

    context.context.subscriptions.push(
      provider.changeEmitter,
      languages.registerFoldingRangeProvider(docSelector, provider),
      workspace.onDidOpenTextDocument((doc) => {
        provider.warmAndSignal(doc);
      }),
      // Reopening a closed editor often re-attaches the retained document model
      // without re-firing onDidOpenTextDocument, so also signal on editor activation.
      window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          provider.warmAndSignal(editor.document);
        }
      }),
    );

    // Cover logs already open when the extension activates.
    for (const doc of workspace.textDocuments) {
      provider.warmAndSignal(doc);
    }
  }
}

export { RawLogFoldingProvider };
