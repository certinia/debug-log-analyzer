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

  /** Open a file by path (desktop) or URI string (web-safe). */
  showFile(pathOrUri: string | Uri, options: TextDocumentShowOptions = {}): void {
    const uri = typeof pathOrUri === 'string' ? Uri.parse(pathOrUri.trim()) : pathOrUri;
    commands.executeCommand('vscode.open', uri, options);
  }
}
