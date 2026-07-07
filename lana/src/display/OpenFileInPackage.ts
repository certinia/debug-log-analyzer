/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { basename } from 'path';
import { Position, Selection, ViewColumn, workspace, type TextDocumentShowOptions } from 'vscode';

import type { Context } from '../Context.js';
import { getMethodLine, parseApex } from '../salesforce/ApexParser/ApexSymbolLocator.js';
import { parseSymbol } from '../salesforce/codesymbol/ApexSymbolParser.js';

export class OpenFileInPackage {
  static async openFileForSymbol(context: Context, symbolName: string): Promise<void> {
    if (!symbolName?.trim()) {
      return;
    }

    await context.workspaceManager.initialiseWorkspaceProjectInfo();
    const apexSymbol = parseSymbol(symbolName, context.workspaceManager.getAllProjects());

    const uri = await context.workspaceManager.findSymbol(apexSymbol);
    if (!uri) {
      context.display.showErrorMessage(
        `Type '${apexSymbol.fullSymbol}' was not found in workspace`,
      );
      return;
    }

    const document = await workspace.openTextDocument(uri);
    const parsedRoot = parseApex(document.getText());

    const symbolLocation = getMethodLine(parsedRoot, symbolName);

    if (!symbolLocation.isExactMatch) {
      context.display.showErrorMessage(
        `Symbol '${symbolLocation.missingSymbol}' could not be found in file '${basename(uri.fsPath)}'`,
      );
    }
    const zeroIndexedLineNumber = symbolLocation.line - 1;
    const character = symbolLocation.character ?? 0;

    const pos = new Position(zeroIndexedLineNumber, character);

    const options: TextDocumentShowOptions = {
      preserveFocus: false,
      preview: false,
      viewColumn: ViewColumn.Active,
      selection: new Selection(pos, pos),
    };

    context.display.showFile(uri.fsPath, options);
  }
}
