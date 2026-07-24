/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Utils } from 'vscode-uri';
import { window } from 'vscode';

import type { Context } from '../Context.js';
import type { VSWorkspace } from '../workspace/VSWorkspace.js';
import { Item, Options, QuickPick } from './QuickPick.js';

export class QuickPickWorkspace {
  static async pickOrReturn(context: Context): Promise<VSWorkspace> {
    if (context.workspaces.length > 1) {
      const [workspace] = await QuickPick.pick(
        context.workspaces.map((ws) => new Item(ws.name(), ws.uri, '')),
        new Options('Select a workspace:'),
      );

      if (workspace) {
        const selectedWs = context.workspaces.find((ws) => ws.uri === workspace.description);
        if (!selectedWs) {
          throw new Error('Selected workspace not found');
        }
        return selectedWs;
      } else {
        throw new Error('No workspace selected');
      }
    } else if (context.workspaces.length === 1) {
      const ws = context.workspaces[0];
      if (!ws) {
        throw new Error('No workspace available');
      }
      return ws;
    } else {
      // No workspace folders — fall back to active editor's containing folder
      // (web: memfs:// or vscode-vfs://; desktop: file://)
      if (window.activeTextEditor) {
        const docUri = window.activeTextEditor.document.uri;
        const folderUri = Utils.dirname(docUri);
        // Construct a minimal VSWorkspace-like object. Since VSWorkspace expects
        // a WorkspaceFolder, we create a synthetic one for the active editor's parent dir.
        const syntheticFolder = {
          uri: folderUri,
          name: Utils.basename(folderUri),
          index: 0,
        };
        return new (await import('../workspace/VSWorkspace.js')).VSWorkspace(syntheticFolder);
      } else {
        throw new Error('No workspace selected');
      }
    }
  }
}
