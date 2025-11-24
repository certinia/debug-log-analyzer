import type { SfdxProject } from './SfdxProjectReader';

export type ApexSymbol = {
  fullSymbol: string;
  namespace: string | null;
  outerClass: string;
  innerClass: string | null;
  method: string;
  parameters: string;
};

type ApexSymbolParts = [string, string, string?, string?];

export function parseSymbol(symbol: string, projects: SfdxProject[]): ApexSymbol {
  const symbolParts = getSymbolParts(symbol);

  if (!symbolParts?.length) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }

  const hasNamespace = symbolHasNamespace(projects, symbolParts);

  const [methodName, params] = symbolParts[symbolParts.length - 1]!.split('(') as [string, string];
  const paramStr = params?.replace(')', '').trim();

  return {
    fullSymbol: symbol,
    namespace: hasNamespace ? symbolParts[0] : null,
    outerClass: hasNamespace ? symbolParts[1] : symbolParts[0],
    innerClass:
      hasNamespace && symbolParts.length === 4
        ? symbolParts[2]!
        : !hasNamespace && symbolParts.length === 3
          ? symbolParts[1]
          : null,
    method: methodName,
    parameters: paramStr,
  };
}

function getSymbolParts(symbol: string): ApexSymbolParts {
  const openingParentheses = symbol.indexOf('(');

  if (openingParentheses === -1) {
    return symbol.split('.') as ApexSymbolParts;
  }

  const path = symbol.slice(0, openingParentheses);
  const params = symbol.slice(openingParentheses);

  const parts = path.split('.');
  parts[parts.length - 1] += params;

  return parts as ApexSymbolParts;
}

function symbolHasNamespace(projects: SfdxProject[], symbolParts: ApexSymbolParts) {
  return symbolParts.length === 4 || !!findNamespacedProject(projects, symbolParts[0]!).length;
}

function findNamespacedProject(projects: SfdxProject[], namespace: string) {
  return projects.filter((project) => project.namespace === namespace);
}
