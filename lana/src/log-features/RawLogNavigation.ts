/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Selection, window, workspace } from 'vscode';

/**
 * Handles navigation within raw Apex log files.
 * Provides utilities for jumping to specific locations by timestamp.
 */
export class RawLogNavigation {
  /**
   * Navigate to a specific line in a log file by timestamp.
   * Opens the document, selects the matching line, and centers it in view.
   *
   * @param logPath - Path to the log file
   * @param timestamp - Nanosecond timestamp to find (from log event)
   */
  public static async goToLineByTimestamp(logPath: string, timestamp: number): Promise<void> {
    try {
      const doc = await workspace.openTextDocument(logPath);
      const text = doc.getText();

      // Search for the timestamp pattern: (nanoseconds)|
      const searchPattern = `(${timestamp})|`;
      const index = text.indexOf(searchPattern);

      if (index !== -1) {
        const position = doc.positionAt(index);
        const editor = await window.showTextDocument(doc, { preview: false });

        // Select the entire line with cursor at start (VS Code-native highlight)
        const line = doc.lineAt(position.line);
        editor.selection = new Selection(line.range.end, line.range.start);
        editor.revealRange(line.range, 1); // 1 = TextEditorRevealType.InCenter
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      window.showErrorMessage(`Unable to navigate to log line: ${msg}`);
    }
  }
}
