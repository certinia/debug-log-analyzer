/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Uri, type ExtensionContext } from 'vscode';

import { ShowAnalysisCodeLens } from './codelenses/ShowAnalysisCodeLens.js';
import { RetrieveLogFile } from './commands/RetrieveLogFile.js';
import { ShowLogAnalysis } from './commands/ShowLogAnalysis.js';
import { Display } from './display/Display.js';
import { WhatsNewNotification } from './display/WhatsNewNotification.js';
import type { ApexSymbol } from './salesforce/codesymbol/ApexSymbolParser.js';
import { VSWorkspaceManager } from './workspace/VSWorkspaceManager.js';

export class Context {
  context: ExtensionContext;
  display: Display;
  workspaceManager = new VSWorkspaceManager();

  constructor(context: ExtensionContext, display: Display) {
    this.context = context;
    this.display = display;

    RetrieveLogFile.apply(this);
    ShowLogAnalysis.apply(this);
    ShowAnalysisCodeLens.apply(this);
    WhatsNewNotification.apply(this);
  }

  async findSymbol(apexSymbol: ApexSymbol): Promise<Uri[]> {
    const path = await this.workspaceManager.findSymbol(apexSymbol);

    if (!path.length) {
      this.display.showErrorMessage(`Type '${apexSymbol.fullSymbol}' was not found in workspace`);
    }
    return path;
  }
}
