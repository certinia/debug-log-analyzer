/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Selection, Uri, commands, window, workspace } from 'vscode';

/**
 * Handles navigation within raw Apex log files.
 * Provides utilities for jumping to specific locations by timestamp.
 */
export class RawLogNavigation {
  /**
   * Navigate to a specific line in a log file by timestamp.
   * Uses vscode.open command to support files >50MB (openTextDocument has 50MB limit).
   *
   * @param logPath - Path to the log file
   * @param timestamp - Nanosecond timestamp to find (from log event)
   */
  public static async goToLineByTimestamp(logPath: string, timestamp: number): Promise<void> {
    try {
      const uri = Uri.file(logPath);

      // Read file (no normalization - avoids doubling memory for large files)
      const text = new TextDecoder().decode(await workspace.fs.readFile(uri));

      // Find the exact timestamp pattern: (nanoseconds)|
      const index = text.indexOf(`(${timestamp})|`);
      if (index === -1) {
        return;
      }

      // Count lines using split (V8 optimized, substring shares memory)
      const lineNumber = text.substring(0, index).split('\n').length - 1;

      // Get line boundaries
      const lineStart = text.lastIndexOf('\n', index) + 1;
      let lineEnd = text.indexOf('\n', index);
      if (lineEnd === -1) {
        lineEnd = text.length;
      }

      // Calculate line length, excluding \r if CRLF line ending
      let lineLength = lineEnd - lineStart;
      if (lineLength > 0 && text[lineEnd - 1] === '\r') {
        lineLength--;
      }

      // Open file with line selected (cursor ends up at end - VS Code limitation)
      await commands.executeCommand('vscode.open', uri, {
        preview: false,
        selection: new Selection(lineNumber, 0, lineNumber, lineLength),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      window.showErrorMessage(`Unable to navigate to log line: ${msg}`);
    }
  }
}
