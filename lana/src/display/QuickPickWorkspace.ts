/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { window } from 'vscode';
import { Utils } from 'vscode-uri';

import type { Context } from '../Context.js';
import { VSWorkspace } from '../workspace/VSWorkspace.js';
import { Item, Options, QuickPick } from './QuickPick.js';

export class QuickPickWorkspace {
  static async pickOrReturn(context: Context): Promise<VSWorkspace> {
    const workspaceFolders = context.workspaceManager.workspaceFolders;

    if (workspaceFolders.length > 1) {
      const [workspace] = await QuickPick.pick(
        workspaceFolders.map((ws) => new Item(ws.name(), ws.uri, '')),
        new Options('Select a workspace:'),
      );

      if (workspace) {
        const selectedWorkspace = workspaceFolders.find((ws) => ws.uri === workspace.description);
        if (!selectedWorkspace) {
          throw new Error('Selected workspace not found');
        }
        return selectedWorkspace;
      } else {
        throw new Error('No workspace selected');
      }
    } else if (workspaceFolders.length === 1) {
      const selectedWorkspace = workspaceFolders[0];
      if (!selectedWorkspace) {
        throw new Error('No workspace available');
      }
      return selectedWorkspace;
    } else {
      if (window.activeTextEditor) {
        const documentUri = window.activeTextEditor.document.uri;
        const folderUri = Utils.dirname(documentUri);
        return new VSWorkspace({
          uri: folderUri,
          name: Utils.basename(folderUri),
          index: 0,
        });
      } else {
        throw new Error('No workspace selected');
      }
    }
  }
}
