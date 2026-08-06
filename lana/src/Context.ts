/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import type { ExtensionContext } from 'vscode';

import { LogEventCache } from './cache/LogEventCache.js';
import { ShowAnalysisCodeLens } from './codelenses/ShowAnalysisCodeLens.js';
import { RetrieveLogFile } from './commands/RetrieveLogFile.js';
import { ShowInLogAnalysis } from './commands/ShowInLogAnalysis.js';
import { ShowLogAnalysis } from './commands/ShowLogAnalysis.js';
import { SwitchTimelineTheme } from './commands/SwitchTimelineTheme.js';
import { LogTimingDecoration } from './decorations/LogTimingDecoration.js';
import { RawLogLineDecoration } from './decorations/RawLogLineDecoration.js';
import type { Display } from './display/Display.js';
import { WhatsNewNotification } from './display/WhatsNewNotification.js';
import { RawLogFoldingProvider } from './folding/RawLogFoldingProvider.js';
import { ApexLogLanguageDetector } from './language/ApexLogLanguageDetector.js';
import { RawLogSymbolProvider } from './symbols/RawLogSymbolProvider.js';
import { VSWorkspaceManager } from './workspace/VSWorkspaceManager.js';

export class Context {
  context: ExtensionContext;
  display: Display;
  workspaceManager = new VSWorkspaceManager();

  constructor(context: ExtensionContext, display: Display) {
    this.context = context;
    this.display = display;

    ApexLogLanguageDetector.apply(this);
    LogEventCache.apply(this);
    RetrieveLogFile.apply(this);
    ShowLogAnalysis.apply(this);
    ShowInLogAnalysis.apply(this);
    SwitchTimelineTheme.apply(this);
    ShowAnalysisCodeLens.apply(this);
    LogTimingDecoration.apply(this);
    RawLogLineDecoration.apply(this);
    RawLogFoldingProvider.apply(this);
    RawLogSymbolProvider.apply(this);
    WhatsNewNotification.apply(this);
  }
}
