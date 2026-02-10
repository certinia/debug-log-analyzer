/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { window } from 'vscode';

import { Context } from '../Context.js';
import { Command } from './Command.js';
import { LogView } from './LogView.js';

interface ShowInLogAnalysisArgs {
  timestamp: number;
  filePath?: string;
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

    let panel = LogView.getCurrentView();
    const logPath = LogView.getLogPath();

    // If panel doesn't exist, open the log analysis view first
    if (!panel) {
      const activeEditor = window.activeTextEditor;
      const logFilePath = filePath ?? activeEditor?.document.uri.fsPath;

      if (!logFilePath) {
        context.display.showInformationMessage('No active Apex log file.');
        return;
      }

      // Set pending navigation so it's sent after log is parsed
      LogView.setPendingNavigation(timestamp);
      panel = await LogView.createView(context, Promise.resolve(), logFilePath);
      return; // Navigation will happen via fetchLog payload
    } else {
      // Panel exists - reveal it first
      panel.reveal();

      // Verify we're navigating to the same log
      const activeEditor = window.activeTextEditor;
      if (logPath && activeEditor && activeEditor.document.uri.fsPath !== logPath) {
        // Different log file is active, open the active one
        LogView.setPendingNavigation(timestamp);
        await LogView.createView(context, Promise.resolve(), activeEditor.document.uri.fsPath);
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
