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
  findSymbol(wsPath: string, symbol: string): string {
    const ws = Workspaces.get(wsPath);
    const path = ws.findType(symbol);
    if (path == null) throw new SymbolFinderError(`Symbol ${symbol} not found`);
    return path;
  }
}
