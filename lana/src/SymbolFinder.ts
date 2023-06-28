/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Workspace, Workspaces } from '@apexdevtools/apex-ls';

export class SymbolFinder {
  findSymbol(wsPath: string, symbol: string): string | null {
    const ws = Workspaces.get(wsPath);
    return this.findInWorkspace(ws, symbol);
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
