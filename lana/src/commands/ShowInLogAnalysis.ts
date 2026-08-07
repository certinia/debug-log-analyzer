/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { Uri, window } from 'vscode';

import type { Context } from '../Context.js';
import { Command } from './Command.js';
import { LogView } from './LogView.js';

interface ShowInLogAnalysisArgs {
  timestamp: number;
  filePath?: string; // URI string (desktop file:// or web vscode-vfs://)
}

export class ShowInLogAnalysis {
  static apply(context: Context): void {
    const command = new Command(
      'showInLogAnalysis',
      'Log: Show in Log Analysis',
      (args: ShowInLogAnalysisArgs) => ShowInLogAnalysis.execute(context, args),
    );
    command.register(context);
  }

  private static async execute(context: Context, args: ShowInLogAnalysisArgs): Promise<void> {
    const { timestamp, filePath } = args;

    if (!timestamp) {
      return;
    }

    const panel = LogView.getCurrentView();
    const logPathStr = LogView.getLogPath(); // URI string of current log

    // If panel doesn't exist, open the log analysis view first
    if (!panel) {
      const activeEditor = window.activeTextEditor;
      const logUri = filePath ? Uri.parse(filePath) : activeEditor?.document.uri;

      if (!logUri) {
        context.display.showInformationMessage('No active Apex log file.');
        return;
      }

      // Set pending navigation so it's sent after log is parsed
      LogView.setPendingNavigation(timestamp);
      await LogView.createView(context, Promise.resolve(), logUri);
      return; // Navigation will happen via fetchLog payload
    } else {
      // Panel exists - reveal it first
      panel.reveal();

      // Verify we're navigating to the same log
      const activeEditor = window.activeTextEditor;
      if (logPathStr && activeEditor && activeEditor.document.uri.toString() !== logPathStr) {
        // Different log file is active, open the active one
        LogView.setPendingNavigation(timestamp);
        await LogView.createView(context, Promise.resolve(), activeEditor.document.uri);
        return; // Navigation will happen via fetchLog payload
      }
    }

    // Send navigation message to webview
    panel.webview.postMessage({
      cmd: 'navigateToTimeline',
      payload: { timestamp },
    });
  }
}
