/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import type { Uri } from 'vscode';

import { findFiles } from '../../services/salesforceServices.js';
import type { VSWorkspace } from '../../workspace/VSWorkspace.js';

/**
 * Finds Apex symbol definitions (classes) within Salesforce workspaces.
 * Searches across multiple workspaces and supports nested symbol resolution.
 *
 * NOTE: Apex LSP delegation considered but not viable:
 * - The Apex language server (salesforce.apex-language-server-extension) does NOT
 *   expose name-based symbol lookup:
 *   - `workspaceSymbolProvider` is undefined in all capability profiles
 *   - `onWorkspaceSymbol` is never wired
 *   - `definitionProvider` / `documentSymbolProvider` are position-based (require
 *     the .cls already open with a cursor)
 *   - `activate()` returns void — no exported API
 *   - memfs is explicitly unsupported for file search
 * - Delegating would still require resolving ClassName→file via glob first (the very
 *   step we own), so there's no benefit today.
 * - If the Apex LSP later enables `workspace/symbol`, revisit delegation.
 */
export class SymbolFinder {
  /**
   * Searches for a symbol across multiple workspaces using glob-based file search.
   * @param workspaces - Array of VS Code workspaces to search in
   * @param symbol - The fully qualified or partial symbol name to find
   * @returns Array of URIs to .cls files containing the symbol
   */
  async findSymbol(_workspaces: VSWorkspace[], symbol: string): Promise<Uri[]> {
    // Note: Currently searches all workspace folders via FsService.findFiles,
    // which honors the active workspace context. The workspaces parameter is
    // kept for API compatibility but not used directly.
    return this.findInWorkspace(symbol);
  }

  /**
   * Searches for a symbol within workspaces, recursively resolving nested symbols.
   * If a symbol is not found, attempts to find its parent namespace by removing the last segment.
   * @param symbol - The symbol name to find (can be fully qualified like 'namespace.ClassName')
   * @returns Array of URIs to .cls files matching the symbol, or empty if not found
   */
  private async findInWorkspace(symbol: string): Promise<Uri[]> {
    // Extract the class name (last segment after stripping method/namespace)
    const className = symbol.split('.').pop() || symbol;
    // Glob for **/{ClassName}.cls (case-insensitive filesystems will match)
    const glob = `**/${className}.cls`;
    const matches = await findFiles(glob, 100);

    if (matches.length === 0) {
      // Fallback: try parent namespace if nested (e.g., 'ns.Class' → 'ns')
      const parts = symbol.split('.');
      if (parts.length > 1) {
        parts.pop();
        return this.findInWorkspace(parts.join('.'));
      }
      return [];
    }

    return matches;
  }
}
