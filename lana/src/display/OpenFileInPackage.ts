/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { sep } from 'path';
import {
  Position,
  Selection,
  Uri,
  ViewColumn,
  workspace,
  type TextDocumentShowOptions,
} from 'vscode';

import { Context } from '../Context.js';
import { Item, Options, QuickPick } from './QuickPick.js';

import { getMethodLine, parseApex } from '../salesforce/ApexParser/ApexSymbolLocator.js';

export class OpenFileInPackage {
  static async openFileForSymbol(context: Context, symbolName: string): Promise<void> {
    if (!symbolName?.length) {
      return;
    }

    const parts = symbolName.split('.');
    const fileName = parts[0];

    const paths = await context.findSymbol(fileName as string);
    if (!paths.length) {
      return;
    }

    const matchingWs = context.workspaces.filter((ws) => {
      const found = paths.findIndex((p) => p.startsWith(ws.path()));
      if (found > -1) {
        return ws;
      }
    });

    const [wsPath] =
      matchingWs.length > 1
        ? await QuickPick.pick(
            matchingWs.map((p) => new Item(p.name(), p.path(), '')),
            new Options('Select a workspace:'),
          )
        : [new Item(matchingWs[0]?.name() || '', matchingWs[0]?.path() || '', '')];
    if (!wsPath) {
      return;
    }

    const wsPathTrimmed = wsPath.description.trim();
    const path =
      paths.find((e) => {
        return e.startsWith(wsPathTrimmed + sep);
      }) || '';

    const uri = Uri.file(path);
    const document = await workspace.openTextDocument(uri);

    const parsedRoot = parseApex(document.getText());

    const symbolLocation = getMethodLine(parsedRoot, parts);

    if (!symbolLocation.isExactMatch) {
      context.display.showErrorMessage(
        `Symbol '${symbolLocation.missingSymbol}' could not be found in file '${fileName}'`,
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

    context.display.showFile(path, options);
  }
}
