/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  commands,
  window,
  type MessageOptions,
  type TextDocumentShowOptions,
  type Uri,
} from 'vscode';

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

  showFile(uri: Uri, options: TextDocumentShowOptions = {}): void {
    commands.executeCommand('vscode.open', uri, options);
  }
}
