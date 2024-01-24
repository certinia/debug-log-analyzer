import { CodeLens, Range, languages, type CodeLensProvider, type TextDocument } from 'vscode';

import { Context } from '../Context.js';
import { ShowLogAnalysis } from '../commands/ShowLogAnalysis.js';

class ShowAnalysisCodeLens implements CodeLensProvider {
  context: Context;
  constructor(context: Context) {
    this.context = context;
  }
  // Each provider requires a provideCodeLenses function which will give the various documents the code lenses
  async provideCodeLenses(_document: TextDocument): Promise<CodeLens[]> {
    // Define where the CodeLens will exist
    const topOfDocument = new Range(0, 0, 0, 0);

    // Define what command we want to trigger when activating the CodeLens
    const command = ShowLogAnalysis.getCommand(this.context);
    const codeLens = new CodeLens(topOfDocument, {
      command: command.fullName,
      title: command.title,
    });

    return [codeLens];
  }

  static apply(context: Context): void {
    // Get a document selector for the CodeLens provider
    // This one is any file that has the language of apexlog
    const docSelector = [{ scheme: 'file', language: 'apexlog' }];

    // Register our CodeLens provider
    const codeLensProviderDisposable = languages.registerCodeLensProvider(
      docSelector,
      new ShowAnalysisCodeLens(context),
    );

    // Push the command and CodeLens provider to the context so it can be disposed of later
    context.context.subscriptions.push(codeLensProviderDisposable);
  }
}

export { ShowAnalysisCodeLens };
