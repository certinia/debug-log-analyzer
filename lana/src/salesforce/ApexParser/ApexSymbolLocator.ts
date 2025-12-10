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
  character: number;
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

export function getMethodLine(rootNode: ApexNode, fullyQualifiedSymbol: string): SymbolLocation {
  const result: SymbolLocation = { character: 0, line: 1, isExactMatch: true };

  if (fullyQualifiedSymbol.indexOf('(') === -1) {
    return result;
  }

  // NOTE: The symbol may contain namespaces as symbols from the debug log are fully qualified e.g myns.MyClass.InnerClass.method(args)
  // We are attempting rudamentary handling of the case where symbols contain namespace but the parsed class does not but no guarantees it work in all cases.

  // There are two possible symbol types method and constructor, args are optional
  // MyClass.method(args) - method,  MyClass.InnerClass.method(args) - method
  // MyClass(args) - constuctor, MyClass.InnerClass(args) - constuctor

  // Find the Namespace of the supplied symbol, if there is one.
  const outerClassNode = rootNode.children?.[0];
  let outerClassName = outerClassNode?.name ?? '';
  const endNsIndex = fullyQualifiedSymbol.indexOf(outerClassName);
  const namespace = endNsIndex > 0 ? fullyQualifiedSymbol.slice(0, endNsIndex - 1) : '';
  if (namespace) {
    outerClassName = namespace + '.' + outerClassName;
    // Remove the leading namespace as most likely the source code will not have it, for symbols in this file.
    fullyQualifiedSymbol = fullyQualifiedSymbol.replace(namespace + '.', '');
  }

  // strip all whitespace to make comparisons easier
  fullyQualifiedSymbol = fullyQualifiedSymbol.replaceAll(' ', '').toLowerCase();

  // This is the index of the first '(' which indicates method args or constructor args.
  const methodArgsIndex = fullyQualifiedSymbol.indexOf('(');
  // We can't tell the difference between InnerClass constructor and outer class method call.
  // As such className could either be the class name or the method name, we need to check.
  const className = fullyQualifiedSymbol.slice(0, methodArgsIndex);
  let currentRoot: ApexNode | undefined = rootNode;
  // Keep iterating until we find the last symbol that is a class.
  // The next symbol might be a method or might be invalid.
  for (const symbol of className.split('.')) {
    const nextRoot = findClassNode(currentRoot, symbol, namespace);
    if (!nextRoot) {
      break;
    }

    currentRoot = nextRoot;
  }

  if (currentRoot) {
    result.line = currentRoot.line ?? 1;
    result.character = currentRoot.idCharacter ?? 0;
  }

  // TODO: enchance to find constructors as well as methods

  // This is the method name before the args list, this may actually be a class name though so we need to check.
  // e.g for MyClass.InnerClass(args) we get InnerClass(args) but is this a method of InnerClass constructor?
  const qualifiedMethodName = fullyQualifiedSymbol.slice(className.lastIndexOf('.') + 1);
  if (qualifiedMethodName && currentRoot) {
    const methodNode = findMethodNode(currentRoot, qualifiedMethodName, outerClassName);

    if (!methodNode) {
      result.line = currentRoot.line ?? 1;
      result.isExactMatch = false;
      result.missingSymbol = qualifiedMethodName;
    } else {
      result.line = methodNode.line;
      result.character = methodNode.idCharacter;
    }
  }

  return result;
}

function findClassNode(root: ApexNode, symbol: string, namespace: string): ApexNode | undefined {
  const classNode = root.children?.find(
    (child) => child.name === symbol && child.nature === 'Class',
  );
  if (classNode) {
    return classNode;
  }

  if (namespace) {
    return root.children?.find(
      (child) => child.name === symbol.replaceAll(namespace + '.', '') && child.nature === 'Class',
    );
  }

  return undefined;
}

function findMethodNode(
  root: ApexNode,
  symbol: string,
  outerClassName: string,
): ApexMethodNode | undefined {
  const [methodName, args = ''] = symbol.slice(0, -1).split('(');
  let params = args;

  const methodNode = root.children?.find(
    (child) =>
      child.name === methodName &&
      child.nature === 'Method' &&
      (params === undefined || (child as ApexMethodNode).params.toLowerCase() === params),
  ) as ApexMethodNode;

  if (methodNode) {
    return methodNode;
  }

  // Try again but with the class name removed from args list. args from the debug log are fully qualified but they are not necessarily in the file,
  // as we only need to qualify for external types to the file.
  // (MyClass.ObjectArg) vs (ObjectArg) where MyClass is current class.
  params = params.replaceAll(outerClassName + '.', '');
  return root.children?.find(
    (child) =>
      child.name === methodName &&
      child.nature === 'Method' &&
      (params === undefined || (child as ApexMethodNode).params.toLowerCase() === params),
  ) as ApexMethodNode;
}
