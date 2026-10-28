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

import type { Context } from '../Context.js';
import { LogEventCache, type LogReporter } from '../cache/LogEventCache.js';
import { isOpenAsTextTab } from '../editor/TabState.js';
import { isApexLogContent } from '../language/ApexLogLanguageDetector.js';

class RawLogFoldingProvider implements FoldingRangeProvider {
  private readonly changeEmitter = new EventEmitter<void>();
  readonly onDidChangeFoldingRanges = this.changeEmitter.event;
  private readonly reporter: LogReporter;

  constructor(reporter: LogReporter) {
    this.reporter = reporter;
  }

  async provideFoldingRanges(
    document: TextDocument,
    _context: FoldingContext,
  ): Promise<FoldingRange[]> {
    if (!isOpenAsTextTab(document.uri)) {
      return [];
    }

    const apexLog = await LogEventCache.getApexLog(document.uri, this.reporter);

    if (!apexLog) {
      return [];
    }

    const { startLine, exitLine } = LogEventCache.linesOf(apexLog, document);
    const ranges: FoldingRange[] = [];
    const last = apexLog.eventCount;
    for (let id = 1; id <= last; id++) {
      if (exitLine[id]! > startLine[id]!) {
        ranges.push(new FoldingRange(startLine[id]!, exitLine[id]!, FoldingRangeKind.Region));
      }
    }
    return ranges;
  }

  /**
   * Warm the parse cache for an Apex log document and signal VS Code to re-request
   * folding ranges once the data is ready. Without this, a slow first parse loses the
   * race against VS Code's initial folding request and folding never appears until an
   * unrelated action forces a re-evaluation.
   */
  private warmAndSignal(document: TextDocument): void {
    if (!isOpenAsTextTab(document.uri) || !isApexLogContent(document)) {
      return;
    }

    void LogEventCache.getApexLog(document.uri, this.reporter).then((apexLog) => {
      if (apexLog) {
        this.changeEmitter.fire();
      }
    });
  }

  static apply(context: Context): void {
    const docSelector = [{ language: 'apexlog' }];
    const provider = new RawLogFoldingProvider(context.display);

    context.context.subscriptions.push(
      provider.changeEmitter,
      languages.registerFoldingRangeProvider(docSelector, provider),
      // Not onDidOpenTextDocument: it fires before the tab model is updated, so the
      // gate would reject a legitimate open. A tab change is also the repair path —
      // a folding request that lost the race is re-requested by the next fire().
      window.tabGroups.onDidChangeTabs(() => {
        const editor = window.activeTextEditor;
        if (editor) {
          provider.warmAndSignal(editor.document);
        }
      }),
      // Reopening a closed editor often re-attaches the retained document model
      // without re-firing the tab change, so also signal on editor activation.
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
