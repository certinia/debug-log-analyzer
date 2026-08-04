/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { SfdxProject } from './SfdxProject';

export type ApexSymbol = {
  fullSymbol: string;
  namespace: string | null;
  outerClass: string;
};

/**
 * Parse a log frame symbol (e.g. `ns.Outer.Inner.method(List<String>)`) into
 * ranked class-lookup candidates, best guess first:
 *
 * 1. Known namespace — the first part matches a project namespace.
 * 2. No namespace — the first part is the outer class. Skipped for 4-part
 *    symbols: Apex nests one level, so `outer.inner.method` is the maximum
 *    without a namespace.
 * 3. Undeclared namespace — the first part is a namespace not declared by any
 *    local project (e.g. a managed package); search all projects for the
 *    second part.
 *
 * Never throws; unparseable input yields no candidates.
 */
export function parseSymbolCandidates(
  symbol: string,
  projects: ReadonlyArray<Pick<SfdxProject, 'namespace'>>,
): ApexSymbol[] {
  // Cut the parameter list before splitting on dots so parenthesised,
  // dot-qualified params (e.g. `(System.String)`) never leak into class parts.
  const openingParentheses = symbol.indexOf('(');
  const path = openingParentheses === -1 ? symbol : symbol.slice(0, openingParentheses);
  const parts = path
    .split('.')
    .map((part) => part.trim())
    .filter((part) => part.length);

  if (!parts.length) {
    return [];
  }

  const candidates: ApexSymbol[] = [];
  const addCandidate = (namespace: string | null, outerClass: string | undefined) => {
    if (
      outerClass &&
      !candidates.some((c) => c.namespace === namespace && c.outerClass === outerClass)
    ) {
      candidates.push({ fullSymbol: symbol, namespace, outerClass });
    }
  };

  const namespaces = new Set(projects.map((project) => project.namespace).filter(Boolean));

  if (parts.length >= 2 && namespaces.has(parts[0]!)) {
    addCandidate(parts[0]!, parts[1]);
  }

  if (parts.length <= 3) {
    addCandidate(null, parts[0]);
  }

  if (parts.length >= 2) {
    addCandidate(null, parts[1]);
  }

  return candidates;
}
