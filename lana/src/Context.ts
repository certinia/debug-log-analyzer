/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { workspace, type ExtensionContext } from 'vscode';

import { ShowAnalysisCodeLens } from './codelenses/ShowAnalysisCodeLens.js';
import { RetrieveLogFile } from './commands/RetrieveLogFile.js';
import { ShowLogAnalysis } from './commands/ShowLogAnalysis.js';
import { Display } from './display/Display.js';
import { WhatsNewNotification } from './display/WhatsNewNotification.js';
import { SymbolFinder } from './salesforce/codesymbol/SymbolFinder.js';
import { VSWorkspace } from './workspace/VSWorkspace.js';

export class Context {
  symbolFinder = new SymbolFinder();
  context: ExtensionContext;
  display: Display;
  workspaces: VSWorkspace[] = [];

  constructor(context: ExtensionContext, display: Display) {
    this.context = context;
    this.display = display;

    if (workspace.workspaceFolders) {
      this.workspaces = workspace.workspaceFolders.map((folder) => {
        return new VSWorkspace(folder);
      });
    }

    RetrieveLogFile.apply(this);
    ShowLogAnalysis.apply(this);
    ShowAnalysisCodeLens.apply(this);
    WhatsNewNotification.apply(this);
  }

  async findSymbol(symbol: string): Promise<string[]> {
    const path = await this.symbolFinder.findSymbol(this.workspaces, symbol);
    if (!path.length) {
      this.display.showErrorMessage(`Type '${symbol}' was not found in workspace`);
    }
    return path;
  }
}
