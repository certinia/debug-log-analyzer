import { CodeLens, Range, languages, type CodeLensProvider, type TextDocument } from 'vscode';

import { Context } from '../Context.js';
import { ShowLogAnalysis } from '../commands/ShowLogAnalysis.js';
import { isApexLogContent } from '../language/ApexLogLanguageDetector.js';

class ShowAnalysisCodeLens implements CodeLensProvider {
  context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    if (!isApexLogContent(document)) {
      return [];
    }

    const topOfDocument = new Range(0, 0, 0, 0);

    const command = ShowLogAnalysis.getCommand(this.context);
    const codeLens = new CodeLens(topOfDocument, {
      command: command.fullName,
      title: command.title,
    });

    return [codeLens];
  }

  static apply(context: Context): void {
    const docSelector = [
      { scheme: 'file', language: 'apexlog' },
      { scheme: 'file', pattern: '**/*.log' },
      { scheme: 'file', pattern: '**/*.txt' },
    ];

    const codeLensProviderDisposable = languages.registerCodeLensProvider(
      docSelector,
      new ShowAnalysisCodeLens(context),
    );

    context.context.subscriptions.push(codeLensProviderDisposable);
  }
}

export { ShowAnalysisCodeLens };
