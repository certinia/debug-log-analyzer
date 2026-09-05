/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  DocumentSymbol,
  languages,
  Position,
  Range,
  SymbolKind,
  window,
  type CancellationToken,
  type Disposable,
  type DocumentFilter,
  type DocumentSymbolProvider,
  type TextDocument,
} from 'vscode';

import type { LogEvent } from 'apex-log-parser';

import type { Context } from '../Context.js';
import { LogEventCache } from '../cache/LogEventCache.js';
import { isOpenAsTextTab } from '../editor/TabState.js';
import { isApexLogContent } from '../language/ApexLogLanguageDetector.js';
import { formatDuration, TIMESTAMP_REGEX } from '../log-utils.js';

/**
 * Document symbols for raw Apex logs. Beyond populating the Outline/breadcrumbs, this is
 * the source VS Code's sticky scroll prefers (the outline model). The folding provider
 * alone only feeds sticky scroll via an unreliable fallback, so parent rows would not pin
 * on scroll without these symbols.
 */
class RawLogSymbolProvider implements DocumentSymbolProvider {
  private registration: Disposable | undefined;
  private lostTabModelRace = false;

  async provideDocumentSymbols(
    document: TextDocument,
    _token: CancellationToken,
  ): Promise<DocumentSymbol[]> {
    if (!isOpenAsTextTab(document.uri)) {
      this.lostTabModelRace = true;
      return [];
    }

    const apexLog = await LogEventCache.getApexLog(document.uri);

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
        // Pushed one at a time: a spread would overrun the argument limit.
        for (const child of children) {
          symbols.push(child);
        }
      }
    }

    return symbols;
  }

  /**
   * Re-register so VS Code asks for symbols again.
   *
   * The only repair path there is: a DocumentSymbolProvider has no change event,
   * so a request that beat the tab model would otherwise leave the Outline empty
   * for the life of the editor. This is the folding provider's changeEmitter.fire().
   */
  private reregister(docSelector: DocumentFilter[]): void {
    this.registration?.dispose();
    this.registration = languages.registerDocumentSymbolProvider(docSelector, this);
  }

  static apply(context: Context): void {
    const docSelector = [{ language: 'apexlog' }];
    const provider = new RawLogSymbolProvider();
    provider.reregister(docSelector);

    // Only retry for a log now sitting in a text tab, so a rejected diff side does
    // not re-register on every tab change for the rest of the session.
    const repair = () => {
      const document = window.activeTextEditor?.document;
      const worthRetrying =
        provider.lostTabModelRace &&
        document &&
        isOpenAsTextTab(document.uri) &&
        isApexLogContent(document);

      // Only cleared on an actual retry: a tab change that arrives before the active
      // editor settles must not spend the one repair the editor event still needs.
      if (worthRetrying) {
        provider.lostTabModelRace = false;
        provider.reregister(docSelector);
      }
    };

    context.context.subscriptions.push(
      { dispose: () => provider.registration?.dispose() },
      // Not onDidOpenTextDocument: it fires before the tab model is updated, so the
      // gate would reject a legitimate open.
      window.tabGroups.onDidChangeTabs(repair),
      // Reopening a closed editor often re-attaches the retained document model
      // without re-firing the tab change.
      window.onDidChangeActiveTextEditor(repair),
    );
  }
}

export { RawLogSymbolProvider };
