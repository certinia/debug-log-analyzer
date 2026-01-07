/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { type Workspace } from '@apexdevtools/apex-ls';

import { VSWorkspace } from '../../workspace/VSWorkspace.js';

/**
 * Finds Apex symbol definitions (classes) within Salesforce workspaces.
 * Searches across multiple workspaces and supports nested symbol resolution.
 */
export class SymbolFinder {
  /**
   * Searches for a symbol across multiple workspaces.
   * @param workspaces - Array of VS Code workspaces to search in
   * @param symbol - The fully qualified or partial symbol name to find
   * @returns Array of file paths to .cls files containing the symbol
   */
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

  /**
   * Searches for a symbol within a single workspace, recursively resolving nested symbols.
   * If a symbol is not found, attempts to find its parent namespace by removing the last segment.
   * @param ws - The Apex workspace to search in
   * @param symbol - The symbol name to find (can be fully qualified like 'namespace.ClassName')
   * @returns Path to the .cls file containing the symbol, or null if not found
   */
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
