/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  DocumentSymbol,
  languages,
  Position,
  Range,
  SymbolKind,
  type CancellationToken,
  type DocumentSymbolProvider,
  type TextDocument,
} from 'vscode';

import type { LogEvent } from 'apex-log-parser';

import type { Context } from '../Context.js';
import { LogEventCache } from '../cache/LogEventCache.js';
import { formatDuration, TIMESTAMP_REGEX } from '../log-utils.js';

/**
 * Document symbols for raw Apex logs. Beyond populating the Outline/breadcrumbs, this is
 * the source VS Code's sticky scroll prefers (the outline model). The folding provider
 * alone only feeds sticky scroll via an unreliable fallback, so parent rows would not pin
 * on scroll without these symbols.
 */
class RawLogSymbolProvider implements DocumentSymbolProvider {
  async provideDocumentSymbols(
    document: TextDocument,
    _token: CancellationToken,
  ): Promise<DocumentSymbol[]> {
    const apexLog = await LogEventCache.getApexLog(document.uri.toString());

    if (!apexLog) {
      return [];
    }

    const timestampToLine = this.buildTimestampMap(document);
    return this.collectSymbols(apexLog.children, timestampToLine, document);
  }

  private buildTimestampMap(document: TextDocument): Map<number, number> {
    const map = new Map<number, number>();

    for (let i = 0; i < document.lineCount; i++) {
      const match = document.lineAt(i).text.match(TIMESTAMP_REGEX);
      if (match?.[1]) {
        const timestamp = parseInt(match[1], 10);
        if (!map.has(timestamp)) {
          map.set(timestamp, i);
        }
      }
    }

    return map;
  }

  private collectSymbols(
    events: LogEvent[],
    timestampToLine: Map<number, number>,
    document: TextDocument,
  ): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];

    for (const event of events) {
      const startLine = timestampToLine.get(event.timestamp);
      const endLine = event.exitStamp !== null ? timestampToLine.get(event.exitStamp) : undefined;
      const children = this.collectSymbols(event.children, timestampToLine, document);

      if (startLine !== undefined && endLine !== undefined && endLine > startLine) {
        // Prefer the parser's concise label (e.g. a method signature) over the raw line,
        // which is prefixed with a timestamp and bloats breadcrumbs / sticky scroll.
        const name =
          event.text.trim() || event.type || document.lineAt(startLine).text.trim() || 'log';
        const detail = formatDuration(event.duration.total);
        const range = new Range(new Position(startLine, 0), document.lineAt(endLine).range.end);
        const selectionRange = document.lineAt(startLine).range;

        const symbol = new DocumentSymbol(name, detail, SymbolKind.Method, range, selectionRange);
        symbol.children = children;
        symbols.push(symbol);
      } else {
        // No foldable range for this event; lift its descendants to this level.
        symbols.push(...children);
      }
    }

    return symbols;
  }

  static apply(context: Context): void {
    const docSelector = [{ scheme: 'file', language: 'apexlog' }];

    context.context.subscriptions.push(
      languages.registerDocumentSymbolProvider(docSelector, new RawLogSymbolProvider()),
    );
  }
}

export { RawLogSymbolProvider };
