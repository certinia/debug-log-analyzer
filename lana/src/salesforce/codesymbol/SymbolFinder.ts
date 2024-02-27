/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { type Workspace } from '@apexdevtools/apex-ls';

import { VSWorkspace } from '../../workspace/VSWorkspace.js';

export class SymbolFinder {
  async findSymbol(workspaces: VSWorkspace[], symbol: string): Promise<string[]> {
    // Dynamic import for code splitting. Improves performance by reducing the amount of JS that is loaded and parsed at the start.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { Workspaces } = await import('@apexdevtools/apex-ls');

    const paths = [];
    for (const ws of workspaces) {
      const apexWs = Workspaces.get(ws.path());
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
