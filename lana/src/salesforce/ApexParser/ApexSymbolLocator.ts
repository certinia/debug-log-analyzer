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
import type { ApexSymbol } from '../codesymbol/ApexSymbolParser';
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

export function getMethodLine(rootNode: ApexNode, apexSymbol: ApexSymbol): SymbolLocation {
  const result: SymbolLocation = { line: 1, isExactMatch: true };

  let currentRoot: ApexNode | undefined = rootNode;

  if (currentRoot.name !== apexSymbol.outerClass) {
    currentRoot = findClassNode(currentRoot, apexSymbol.outerClass);
  }

  if (!currentRoot) {
    result.isExactMatch = false;
    result.missingSymbol = apexSymbol.outerClass;
    return result;
  }

  if (apexSymbol.innerClass) {
    currentRoot = findClassNode(currentRoot, apexSymbol.innerClass);

    if (!currentRoot) {
      result.isExactMatch = false;
      result.missingSymbol = apexSymbol.innerClass;
      return result;
    }
  }

  const methodNode = findMethodNode(currentRoot, apexSymbol);

  if (!methodNode) {
    result.line = currentRoot.line ?? 1;
    result.isExactMatch = false;
    result.missingSymbol = apexSymbol.method + '(' + apexSymbol.parameters + ')';
    return result;
  }

  result.line = methodNode.line;

  return result;
}

function findClassNode(root: ApexNode, symbol: string): ApexNode | undefined {
  return root.children?.find((child) => child.name === symbol && child.nature === 'Class');
}

function findMethodNode(root: ApexNode, apexSymbol: ApexSymbol): ApexMethodNode | undefined {
  const qualifierString = apexSymbol.namespace
    ? `${apexSymbol.namespace}|${apexSymbol.outerClass}`
    : apexSymbol.outerClass;

  return root.children?.find(
    (child) =>
      child.name === apexSymbol.method &&
      child.nature === 'Method' &&
      (apexSymbol.parameters === '' ||
        matchesUnqualified(
          qualifierString,
          (child as ApexMethodNode).params,
          apexSymbol.parameters,
        )),
  ) as ApexMethodNode;
}

function matchesUnqualified(qualifierString: string, str1: string, str2: string): boolean {
  const regex = new RegExp(`\\b(?:${qualifierString}|System)\\.`, 'gi');
  const unqualifiedStr1 = str1.replace(regex, '');
  const unqualifiedStr2 = str2.replace(regex, '');

  return unqualifiedStr1 === unqualifiedStr2;
}
