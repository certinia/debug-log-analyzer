/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Position, Selection, ViewColumn, workspace, type TextDocumentShowOptions } from 'vscode';
import { Utils } from 'vscode-uri';

import type { Context } from '../Context.js';
import { getMethodLine, parseApex } from '../salesforce/ApexParser/ApexSymbolLocator.js';

export class OpenFileInPackage {
  static async openFileForSymbol(context: Context, symbolName: string): Promise<void> {
    if (!symbolName?.trim()) {
      return;
    }

    try {
      const result = await context.workspaceManager.findSymbol(symbolName);
      if (result.status === 'cancelled') {
        return;
      }
      if (result.status === 'not-found') {
        context.display.showErrorMessage(`Type '${symbolName}' was not found in workspace`);
        return;
      }
      const uri = result.uri;

      const document = await workspace.openTextDocument(uri);
      const parsedRoot = parseApex(document.getText());

      const symbolLocation = getMethodLine(parsedRoot, symbolName);

      if (!symbolLocation.isExactMatch) {
        context.display.showErrorMessage(
          `Symbol '${symbolLocation.missingSymbol}' could not be found in file '${Utils.basename(uri)}'`,
        );
      }
      const zeroIndexedLineNumber = symbolLocation.line - 1;
      const pos = new Position(zeroIndexedLineNumber, symbolLocation.character ?? 0);

      const options: TextDocumentShowOptions = {
        preserveFocus: false,
        preview: false,
        viewColumn: ViewColumn.Active,
        selection: new Selection(pos, pos),
      };

      context.display.showFile(uri, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      context.display.showErrorMessage(`Unable to open '${symbolName}': ${message}`);
    }
  }
}
