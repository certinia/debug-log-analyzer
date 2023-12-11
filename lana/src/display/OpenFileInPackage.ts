/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  Position,
  Selection,
  type TextDocumentShowOptions,
  Uri,
  ViewColumn,
  commands,
} from 'vscode';

import { Context } from '../Context.js';

export class OpenFileInPackage {
  static async openFileForSymbol(
    context: Context,
    name: string,
    lineNumber?: number,
  ): Promise<void> {
    const path = await context.findSymbol(name);
    if (path && lineNumber) {
      const zeroBasedLine = lineNumber - 1;
      const linePosition = new Position(zeroBasedLine, 0);

      const options: TextDocumentShowOptions = {
        preserveFocus: false,
        preview: false,
        viewColumn: ViewColumn.Active,
        selection: new Selection(linePosition, linePosition),
      };

      commands.executeCommand('vscode.open', Uri.file(path.trim()), options);
    }
  }
}
