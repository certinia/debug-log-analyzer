/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Position, Range, Uri, window, workspace } from "vscode";
import { Context } from "../Context";

export class OpenFileInPackage {
  static openFileForSymbol(
    wsPath: string,
    context: Context,
    name: string,
    line?: number
  ): void {
    const path = context.findSymbol(wsPath, name);
    if (path) {
      const uri = Uri.file(path);
      workspace.openTextDocument(uri).then((td) => {
        window.showTextDocument(td).then((editor) => {
          if (line) {
            const position = new Position(line, 0);
            editor.revealRange(new Range(position, position));
          }
        });
      });
    }
  }
}
