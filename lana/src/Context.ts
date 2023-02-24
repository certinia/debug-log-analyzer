/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { ExtensionContext, workspace } from 'vscode';
import { LoadLogFile } from './commands/LoadLogFile';
import { ShowLogFile } from './commands/ShowLogFile';
import ShowAnalysisCodeLens from './codelenses/ShowAnalysisCodeLens';
import { Display } from './Display';
import { SymbolFinder } from './SymbolFinder';
import { VSWorkspace } from './workspace/VSWorkspace';

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

    LoadLogFile.apply(this);
    ShowLogFile.apply(this);
    ShowAnalysisCodeLens.apply(this);
  }

  findSymbol(wsPath: string, symbol: string): string | null {
    const path = this.symbolFinder.findSymbol(wsPath, symbol);
    if (!path) {
      this.display.showErrorMessage(`Type '${symbol}' was not found in workspace`);
    }
    return path;
  }
}
