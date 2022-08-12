/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { ExtensionContext, Uri, window, workspace } from "vscode";
import { appName } from "./AppSettings";

export class Display {
  private outputChannel = window.createOutputChannel(appName);

  constructor(context: ExtensionContext) { }

  output(message: string, showChannel: boolean = false) {
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
    workspace
      .openTextDocument(Uri.file(path))
      .then((td) => window.showTextDocument(td));
  }
}
