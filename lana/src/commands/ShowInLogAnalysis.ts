/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { Uri, window } from 'vscode';

import type { Context } from '../Context.js';
import { Command } from './Command.js';
import { LogView } from './LogView.js';

interface ShowInLogAnalysisArgs {
  eventIndex: number;
  filePath?: string;
}

export class ShowInLogAnalysis {
  static apply(context: Context): void {
    const command = new Command(
      'showInLogAnalysis',
      'Log: Show in Log Analysis',
      context,
      'Error showing the log analysis',
      (args: ShowInLogAnalysisArgs) => ShowInLogAnalysis.execute(context, args),
    );
    command.register();
  }

  private static async execute(context: Context, args: ShowInLogAnalysisArgs): Promise<void> {
    const { eventIndex, filePath } = args;

    if (!eventIndex) {
      return;
    }

    // The log the link names, so an id meant for one parse is never sent to another log.
    const logUri = filePath ? Uri.parse(filePath) : window.activeTextEditor?.document.uri;
    if (!logUri) {
      context.display.showInformationMessage('No active Apex log file.');
      return;
    }

    const panel = LogView.getCurrentView();
    if (panel && LogView.getLogUri()?.toString() === logUri.toString()) {
      panel.reveal();
      panel.webview.postMessage({
        cmd: 'navigateToTimeline',
        payload: { eventIndex },
      });
      return;
    }

    // Sent with the log once it is parsed.
    LogView.setPendingNavigation(eventIndex);
    await LogView.createView(context, Promise.resolve(), logUri);
  }
}
