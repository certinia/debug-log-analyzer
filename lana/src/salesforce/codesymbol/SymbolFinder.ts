/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Workspace, Workspaces } from '@apexdevtools/apex-ls';

import { VSWorkspace } from '../../workspace/VSWorkspace.js';

export class SymbolFinder {
  async findSymbol(workspaces: VSWorkspace[], symbol: string): Promise<string[]> {
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
