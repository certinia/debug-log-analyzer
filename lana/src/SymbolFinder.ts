/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Workspaces, Workspace } from '@apexdevtools/apex-ls';

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
      } else {
        return null;
      }
    }
    return paths[0];
  }
}
