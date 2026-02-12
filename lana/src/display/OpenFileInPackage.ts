/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { basename, sep } from 'path';
import {
  Position,
  Selection,
  Uri,
  ViewColumn,
  workspace,
  type TextDocumentShowOptions,
} from 'vscode';

import { Context } from '../Context.js';
import { SymbolFinder } from '../salesforce/codesymbol/SymbolFinder.js';
import { Item, Options, QuickPick } from './QuickPick.js';

import { getMethodLine, parseApex } from '../salesforce/ApexParser/ApexSymbolLocator.js';

const symbolFinder = new SymbolFinder();

async function findSymbol(context: Context, symbol: string): Promise<string[]> {
  try {
    const path = await symbolFinder.findSymbol(context.workspaces, symbol);
    if (!path.length) {
      context.display.showErrorMessage(`Type '${symbol}' was not found in workspace`);
    }
    return path;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    context.display.showErrorMessage(`Error finding symbol '${symbol}': ${message}`);
  }
  return [];
}

export class OpenFileInPackage {
  static async openFileForSymbol(context: Context, symbolName: string): Promise<void> {
    if (!symbolName?.trim()) {
      return;
    }

    const parts = symbolName.slice(0, symbolName.indexOf('('));

    const paths = await findSymbol(context, parts);
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

    const symbolLocation = getMethodLine(parsedRoot, symbolName);

    if (!symbolLocation.isExactMatch) {
      context.display.showErrorMessage(
        `Symbol '${symbolLocation.missingSymbol}' could not be found in file '${basename(path)}'`,
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

    context.display.showFile(path, options);
  }
}
