/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Workspaces } from "pkgforce";

export class SymbolFinderError extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = "SymbolFinderError";
  }
}

export class SymbolFinder {
  findSymbol(wsPath: string, symbol: string): string | null {
    const ws = Workspaces.get(wsPath);
    // The .d.ts entry is currently wrong, findType returns a string array
    const paths = (ws.findType(symbol) as unknown) as string[];
    if (paths.length == 0) {
      const parts = symbol.split('.');
      if (parts.length > 1) {
        parts.pop()
        return this.findSymbol(wsPath, parts.join('.'))
      } else {
        return null;
      }
    }
    return paths[0];
  }
}
