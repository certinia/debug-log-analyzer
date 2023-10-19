/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { parse } from 'path';
import { window } from 'vscode';

import { Context } from '../Context.js';
import { Item, Options, QuickPick } from './QuickPick.js';

export class QuickPickWorkspace {
  static async pickOrReturn(context: Context): Promise<string> {
    if (context.workspaces.length > 1) {
      const [workspace] = await QuickPick.pick(
        context.workspaces.map((ws) => new Item(ws.name(), ws.path(), '')),
        new Options('Select a workspace:')
      );

      if (workspace) {
        return workspace.description;
      } else {
        throw new Error('No workspace selected');
      }
    } else if (context.workspaces.length === 1) {
      return context.workspaces[0]?.path() || '';
    } else {
      if (window.activeTextEditor) {
        return parse(window.activeTextEditor.document.fileName).dir;
      } else {
        throw new Error('No workspace selected');
      }
    }
  }
}
