/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { Uri, window } from 'vscode';
import { Context } from '../Context';
import { QuickPickWorkspace } from '../display/QuickPickWorkspace';
import * as path from 'path';
import { LogView } from './LogView';
import { Command } from './Command';
import { appName } from '../AppSettings';

export class ShowLogFile {
  static getCommand(context: Context): Command {
    return new Command('showLogFile', 'Log: Show Apex Log Analysis', (uri: Uri) =>
      ShowLogFile.safeCommand(context, uri)
    );
  }

  static apply(context: Context): void {
    ShowLogFile.getCommand(context).register(context);
    context.display.output(`Registered command '${appName}: Show Log'`);
  }

  private static async safeCommand(context: Context, uri: Uri): Promise<void> {
    try {
      return ShowLogFile.command(context, uri);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      context.display.showErrorMessage(`Error showing logfile: ${msg}`);
      return Promise.resolve();
    }
  }

  private static async command(context: Context, uri: Uri): Promise<void> {
    const filePath = uri?.fsPath || window?.activeTextEditor?.document.fileName;

    if (filePath) {
      const name = path.parse(filePath).name;
      const ws = await QuickPickWorkspace.pickOrReturn(context);

      const view = await LogView.createView(ws, context, filePath);
      LogView.appendView(view, context, name, filePath);
    } else {
      context.display.showErrorMessage('No file selected to display log analysis');
      throw new Error('No file selected to display log analysis');
    }
  }
}
