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
import { ApexNature, ApexVisitor, type ApexMethodNode, type ApexNode } from './ApexVisitor';

export function parseApex(apexCode: string): ApexNode {
  const parser = new ApexParser(
    new CommonTokenStream(
      new ApexLexer(new CaseInsensitiveInputStream(CharStreams.fromString(apexCode))),
    ),
  );
  return new ApexVisitor().visit(parser.compilationUnit());
}

export function getMethodLine(rootNode: ApexNode, symbols: string[]): number {
  if (symbols[0] === rootNode.name) {
    symbols = symbols.slice(1);
  }

  if (!symbols.length) {
    return 1;
  }

  let line = 1;
  let currentRoot: ApexNode | undefined = rootNode;

  for (const symbol of symbols) {
    if (!currentRoot) {
      break;
    }

    if (isClassSymbol(symbol)) {
      currentRoot = findClassNode(currentRoot, symbol);
    } else {
      line = findMethodNode(currentRoot, symbol)?.line ?? 1;
    }
  }

  return line;
}

function isClassSymbol(symbol: string): boolean {
  return !symbol.includes('(');
}

function findClassNode(root: ApexNode, symbol: string): ApexNode | undefined {
  return root.children?.find((child) => child.name === symbol && child.nature === ApexNature.class);
}

function findMethodNode(root: ApexNode, symbol: string): ApexMethodNode | undefined {
  const [methodName, params] = symbol.split('(');
  const paramStr = params?.replace(')', '').trim();

  return root.children?.find(
    (child) =>
      child.name === methodName &&
      child.nature === ApexNature.method &&
      (paramStr === undefined || (child as ApexMethodNode).params === paramStr),
  ) as ApexMethodNode;
}
