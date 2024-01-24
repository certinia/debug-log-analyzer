/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { sep } from 'path';
import {
  Position,
  Selection,
  Uri,
  ViewColumn,
  commands,
  type TextDocumentShowOptions,
} from 'vscode';

import { Context } from '../Context.js';
import { Item, Options, QuickPick } from './QuickPick.js';

export class OpenFileInPackage {
  static async openFileForSymbol(
    context: Context,
    name: string,
    lineNumber?: number,
  ): Promise<void> {
    const paths = await context.findSymbol(name);
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

    if (wsPath && lineNumber) {
      const zeroBasedLine = lineNumber - 1;
      const linePosition = new Position(zeroBasedLine, 0);

      const options: TextDocumentShowOptions = {
        preserveFocus: false,
        preview: false,
        viewColumn: ViewColumn.Active,
        selection: new Selection(linePosition, linePosition),
      };

      const wsPathTrimmed = wsPath.description.trim();
      const path =
        paths.find((e) => {
          return e.startsWith(wsPathTrimmed + sep);
        }) || '';
      commands.executeCommand('vscode.open', Uri.file(path), options);
    }
  }
}
