/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { TabInputText, window, type Uri } from 'vscode';

import { appName } from '../AppSettings.js';
import type { Context } from '../Context.js';
import { fileOrFolderExists } from '../fs/workspaceFs.js';
import { Command } from './Command.js';
import { LogView } from './LogView.js';

export class ShowLogAnalysis {
  static getCommand(context: Context): Command {
    return new Command(
      'showLogAnalysis',
      'Log: Show Apex Log Analysis',
      context,
      'Error showing logfile',
      (uri: Uri) => ShowLogAnalysis.command(context, uri),
    );
  }

  static apply(context: Context): void {
    ShowLogAnalysis.getCommand(context).register();
    context.display.output(`Registered command '${appName}: Show Log'`);
  }

  private static async command(context: Context, uri: Uri): Promise<void> {
    const activeTab = window.tabGroups.activeTabGroup.activeTab;
    const logUri =
      uri ||
      window.activeTextEditor?.document.uri ||
      (activeTab?.input instanceof TabInputText ? activeTab.input.uri : undefined);

    if (!logUri) {
      context.display.showErrorMessage(
        'No file selected or the file is too large. Try again using the file explorer or text editor command.',
      );
      throw new Error(
        'No file selected or the file is too large. Try again using the file explorer or text editor command.',
      );
    }

    const fileContent = (await fileOrFolderExists(logUri))
      ? undefined
      : window.activeTextEditor?.document.getText();
    await LogView.createView(context, Promise.resolve(), logUri, fileContent);
  }
}
