/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { Position, Range, Selection, Uri, window, workspace } from 'vscode';
import { Context } from '../Context';

export class OpenFileInPackage {
  static openFileForSymbol(wsPath: string, context: Context, name: string, line?: number): void {
    const path = context.findSymbol(wsPath, name);
    if (path) {
      const uri = Uri.file(path);
      workspace.openTextDocument(uri).then((td) => {
        window.showTextDocument(td).then((editor) => {
          if (line) {
            const zeroBasedLine = line - 1;
            const position = new Position(zeroBasedLine, 0);
            editor.selection = new Selection(position, position);
            editor.revealRange(new Range(position, position));
          }
        });
      });
    }
  }
}
