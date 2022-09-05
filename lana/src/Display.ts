/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Uri, window, workspace } from 'vscode';
import { appName } from './Main';

export class Display {
  private outputChannel = window.createOutputChannel(appName);

  output(message: string, showChannel = false) {
    if (showChannel) {
      this.outputChannel.show(true);
    }
    this.outputChannel.appendLine(message);
  }

  showInformationMessage(s: string): void {
    window.showInformationMessage(s);
  }

  showErrorMessage(s: string): void {
    window.showErrorMessage(s);
  }

  showFile(path: string): void {
    workspace.openTextDocument(Uri.file(path)).then((td) => window.showTextDocument(td));
  }
}
