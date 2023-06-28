/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import * as path from 'path';
import { window } from 'vscode';

import { Context } from '../Context';
import { Item, Options, QuickPick } from './QuickPick';

export class QuickPickWorkspace {
  static async pickOrReturn(context: Context): Promise<string> {
    if (context.workspaces.length > 1) {
      const workspace = await QuickPick.pick(
        context.workspaces.map((ws) => new Item(ws.name(), ws.path(), '')),
        new Options('Select a workspace:')
      );

      if (workspace.length === 1) {
        return workspace[0].description;
      } else {
        throw new Error('No workspace selected');
      }
    } else if (context.workspaces.length === 1) {
      return context.workspaces[0].path();
    } else {
      if (window.activeTextEditor) {
        return path.parse(window.activeTextEditor.document.fileName).dir;
      } else {
        throw new Error('No workspace selected');
      }
    }
  }
}
