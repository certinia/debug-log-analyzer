/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  commands,
  Position,
  Selection,
  ViewColumn,
  workspace,
  type TextDocumentShowOptions,
} from 'vscode';

import { Context } from '../Context.js';

import { getMethodLine, parseApex } from '../salesforce/ApexParser/ApexSymbolLocator.js';
import { parseSymbol } from '../salesforce/codesymbol/ApexSymbolParser.js';

export class OpenFileInPackage {
  static async openFileForSymbol(context: Context, symbolName: string): Promise<void> {
    if (!symbolName?.trim()) {
      return;
    }

    await context.workspaceManager.initialiseWorkspaceProjectInfo();
    const apexSymbol = parseSymbol(symbolName, context.workspaceManager.getAllProjects());

    const uri = await context.findSymbol(apexSymbol);

    if (!uri) {
      return;
    }

    const document = await workspace.openTextDocument(uri);

    const parsedRoot = parseApex(document.getText());

    const symbolLocation = getMethodLine(parsedRoot, apexSymbol);

    if (!symbolLocation.isExactMatch) {
      context.display.showErrorMessage(
        `Symbol '${symbolLocation.missingSymbol}' could not be found in file '${apexSymbol.fullSymbol}'`,
      );
    }
    const zeroIndexedLineNumber = symbolLocation.line - 1;

    const pos = new Position(zeroIndexedLineNumber, 0);

    const options: TextDocumentShowOptions = {
      preserveFocus: false,
      preview: false,
      viewColumn: ViewColumn.Active,
      selection: new Selection(pos, pos),
    };

    commands.executeCommand('vscode.open', uri, options);
  }
}
