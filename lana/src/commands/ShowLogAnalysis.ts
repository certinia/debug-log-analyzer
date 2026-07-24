/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { type Uri, window } from 'vscode';

import { appName } from '../AppSettings.js';
import type { Context } from '../Context.js';
import { fileOrFolderExists } from '../services/salesforceServices.js';
import { Command } from './Command.js';
import { LogView } from './LogView.js';

export class ShowLogAnalysis {
  static getCommand(context: Context): Command {
    return new Command('showLogAnalysis', 'Log: Show Apex Log Analysis', (uri: Uri) =>
      ShowLogAnalysis.safeCommand(context, uri),
    );
  }

  static apply(context: Context): void {
    ShowLogAnalysis.getCommand(context).register(context);
    context.display.output(`Registered command '${appName}: Show Log'`);
  }

  private static async safeCommand(context: Context, uri: Uri): Promise<void> {
    try {
      return ShowLogAnalysis.command(context, uri);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      context.display.showErrorMessage(`Error showing logfile: ${msg}`);
      return Promise.resolve();
    }
  }

  private static async command(context: Context, uri: Uri): Promise<void> {
    const logUri = uri || window?.activeTextEditor?.document.uri;
    if (!logUri) {
      context.display.showErrorMessage(
        'No file selected or the file is too large. Try again using the file explorer or text editor command.',
      );
      throw new Error(
        'No file selected or the file is too large. Try again using the file explorer or text editor command.',
      );
    }

    // Check if file exists on disk (web-safe via FsService).
    // If it doesn't, pass the active editor's inline text (for unsaved/virtual docs).
    let fileContent: string | undefined;
    const exists = await fileOrFolderExists(logUri);
    if (!exists) {
      fileContent = window?.activeTextEditor?.document.getText();
    }

    LogView.createView(context, Promise.resolve(), logUri, fileContent);
  }
}
