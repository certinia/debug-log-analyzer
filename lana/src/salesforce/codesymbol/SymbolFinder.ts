/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { type Workspace } from '@apexdevtools/apex-ls';

import { VSWorkspace } from '../../workspace/VSWorkspace.js';

type GetMethod = (wsPath: string, ignoreIssues: boolean) => Workspace; // This is typed in apex-ls to only have 1 parameter

export class SymbolFinder {
  async findSymbol(workspaces: VSWorkspace[], symbol: string): Promise<string[]> {
    // Dynamic import for code splitting. Improves performance by reducing the amount of JS that is loaded and parsed at the start.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { Workspaces } = await import('@apexdevtools/apex-ls');
    const paths = [];
    for (const ws of workspaces) {
      /**
       * By default, `get` throws on any issues in the workspace. This could be things like Apex classes missing meta files, duplicate classes, etc.
       * We don't care about these issues so pass ignoreIssues parameter to ensure we always get a return.
       */
      const ignoreIssues = true;
      const apexWs = (Workspaces.get as GetMethod)(ws.path(), ignoreIssues);

      if (!apexWs) {
        return [];
      }

      const filePath = this.findInWorkspace(apexWs, symbol);
      if (filePath) {
        paths.push(filePath);
      }
    }

    return paths;
  }

  private findInWorkspace(ws: Workspace, symbol: string): string | null {
    const paths = ws.findType(symbol);
    if (paths.length === 0) {
      const parts = symbol.split('.');
      if (parts.length > 1) {
        parts.pop();
        return this.findInWorkspace(ws, parts.join('.'));
      }
      return null;
    }
    return paths.find((path) => path.endsWith('.cls')) || null;
  }
}
