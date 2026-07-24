/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  Position,
  Selection,
  ViewColumn,
  workspace,
  type TextDocumentShowOptions,
  type Uri,
} from 'vscode';
import { Utils } from 'vscode-uri';

import type { Context } from '../Context.js';
import { SymbolFinder } from '../salesforce/codesymbol/SymbolFinder.js';
import { Item, Options, QuickPick } from './QuickPick.js';

import { getMethodLine, parseApex } from '../salesforce/ApexParser/ApexSymbolLocator.js';

const symbolFinder = new SymbolFinder();

async function findSymbol(context: Context, symbol: string): Promise<Uri[]> {
  try {
    const uris = await symbolFinder.findSymbol(context.workspaces, symbol);
    if (!uris.length) {
      context.display.showErrorMessage(`Type '${symbol}' was not found in workspace`);
    }
    return uris;
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

    const uris = await findSymbol(context, parts);
    if (!uris.length) {
      return;
    }

    // Match URIs to workspaces by URI prefix
    const matchingWs = context.workspaces.filter((ws) => {
      const wsUri = ws.uri;
      return uris.some((u) => u.toString().startsWith(wsUri));
    });

    const [wsItem] =
      matchingWs.length > 1
        ? await QuickPick.pick(
            matchingWs.map((p) => new Item(p.name(), p.uri, '')),
            new Options('Select a workspace:'),
          )
        : [new Item(matchingWs[0]?.name() || '', matchingWs[0]?.uri || '', '')];
    if (!wsItem) {
      return;
    }

    const wsUriStr = wsItem.description.trim();
    const uri =
      uris.find((u) => {
        return u.toString().startsWith(wsUriStr);
      }) || uris[0];

    if (!uri) {
      return;
    }

    const document = await workspace.openTextDocument(uri);

    const parsedRoot = parseApex(document.getText());

    const symbolLocation = getMethodLine(parsedRoot, symbolName);

    if (!symbolLocation.isExactMatch) {
      context.display.showErrorMessage(
        `Symbol '${symbolLocation.missingSymbol}' could not be found in file '${Utils.basename(uri)}'`,
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

    context.display.showFile(uri, options);
  }
}
