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

import { eventType } from '@apexdevtools/apex-log-parser';

import type { Context } from '../Context.js';
import { LogEventCache, type LogReporter } from '../cache/LogEventCache.js';
import { isOpenAsTextTab } from '../editor/TabState.js';
import { isApexLogContent } from '../language/ApexLogLanguageDetector.js';
import { formatDuration } from '../log-utils.js';

/**
 * Document symbols for raw Apex logs. Beyond populating the Outline/breadcrumbs, this is
 * the source VS Code's sticky scroll prefers (the outline model). The folding provider
 * alone only feeds sticky scroll via an unreliable fallback, so parent rows would not pin
 * on scroll without these symbols.
 */
class RawLogSymbolProvider implements DocumentSymbolProvider {
  private registration: Disposable | undefined;
  private lostTabModelRace = false;
  private readonly reporter: LogReporter;

  constructor(reporter: LogReporter) {
    this.reporter = reporter;
  }

  async provideDocumentSymbols(
    document: TextDocument,
    _token: CancellationToken,
  ): Promise<DocumentSymbol[]> {
    if (!isOpenAsTextTab(document.uri)) {
      this.lostTabModelRace = true;
      return [];
    }

    const apexLog = await LogEventCache.getApexLog(document.uri, this.reporter);

    if (!apexLog) {
      return [];
    }

    const { start, end } = LogEventCache.linesOf(apexLog, document);
    const { parent, text, type, durationTotal } = apexLog.columns;
    const symbols = new Map<number, DocumentSymbol>();
    const roots: DocumentSymbol[] = [];
    const last = apexLog.eventCount;
    for (let id = 1; id <= last; id++) {
      const startLine = start[id]!;
      const endLine = end[id]!;
      if (endLine <= startLine) {
        continue;
      }
      // Prefer the parser's concise label (e.g. a method signature) over the raw line,
      // which is prefixed with a timestamp and bloats breadcrumbs / sticky scroll.
      const name =
        text.at(id)?.trim() ||
        eventType(type[id]!)?.type ||
        document.lineAt(startLine).text.trim() ||
        'log';
      const range = new Range(new Position(startLine, 0), document.lineAt(endLine).range.end);
      const symbol = new DocumentSymbol(
        name,
        formatDuration(durationTotal[id]!),
        SymbolKind.Method,
        range,
        document.lineAt(startLine).range,
      );
      // A frame with no foldable range lifts its descendants to the nearest one that has.
      let ancestor = parent[id]!;
      while (ancestor > 0 && !symbols.has(ancestor)) {
        ancestor = parent[ancestor]!;
      }
      (symbols.get(ancestor)?.children ?? roots).push(symbol);
      symbols.set(id, symbol);
    }
    return roots;
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
    const provider = new RawLogSymbolProvider(context.display);
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
