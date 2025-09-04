/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Uri, commands, window, type MessageOptions, type TextDocumentShowOptions } from 'vscode';

import { appName } from '../AppSettings.js';

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

  showErrorMessage(s: string, options: MessageOptions = {}): void {
    window.showErrorMessage(s, options);
  }

  showFile(path: string, options: TextDocumentShowOptions = {}): void {
    commands.executeCommand('vscode.open', Uri.file(path.trim()), options);
  }
}
