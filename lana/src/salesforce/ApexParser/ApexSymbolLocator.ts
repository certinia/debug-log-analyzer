/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import {
  ApexLexer,
  ApexParser,
  CaseInsensitiveInputStream,
  CommonTokenStream,
} from '@apexdevtools/apex-parser';
import { CharStreams } from 'antlr4ts';
import { ApexVisitor, type ApexMethodNode, type ApexNode } from './ApexVisitor';

export type SymbolLocation = {
  line: number;
  isExactMatch: boolean;
  missingSymbol?: string;
};

export function parseApex(apexCode: string): ApexNode {
  const parser = new ApexParser(
    new CommonTokenStream(
      new ApexLexer(new CaseInsensitiveInputStream(CharStreams.fromString(apexCode))),
    ),
  );
  return new ApexVisitor().visit(parser.compilationUnit());
}

export function getMethodLine(rootNode: ApexNode, symbols: string[]): SymbolLocation {
  const result: SymbolLocation = { line: 1, isExactMatch: true };

  if (symbols[0] === rootNode.name) {
    symbols = symbols.slice(1);
  }

  if (!symbols.length) {
    return result;
  }

  let currentRoot: ApexNode | undefined = rootNode;

  for (const symbol of symbols) {
    if (isClassSymbol(symbol)) {
      currentRoot = findClassNode(currentRoot, symbol);

      if (!currentRoot) {
        result.isExactMatch = false;
        result.missingSymbol = symbol;
        break;
      }
    } else {
      const methodNode = findMethodNode(currentRoot, symbol);

      if (!methodNode) {
        result.line = currentRoot.line ?? 1;
        result.isExactMatch = false;
        result.missingSymbol = symbol;
        break;
      }

      result.line = methodNode.line;
    }
  }

  return result;
}

function isClassSymbol(symbol: string): boolean {
  return !symbol.includes('(');
}

function findClassNode(root: ApexNode, symbol: string): ApexNode | undefined {
  return root.children?.find((child) => child.name === symbol && child.nature === 'Class');
}

function findMethodNode(root: ApexNode, symbol: string): ApexMethodNode | undefined {
  const [methodName, params] = symbol.split('(');
  const paramStr = params?.replace(')', '').trim();

  return root.children?.find(
    (child) =>
      child.name === methodName &&
      child.nature === 'Method' &&
      (paramStr === undefined || (child as ApexMethodNode).params === paramStr),
  ) as ApexMethodNode;
}
