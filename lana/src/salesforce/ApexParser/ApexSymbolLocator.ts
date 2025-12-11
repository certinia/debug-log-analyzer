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
import {
  ApexVisitor,
  type ApexConstructorNode,
  type ApexMethodNode,
  type ApexNode,
} from './ApexVisitor';

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
  const result: SymbolLocation = { character: 0, line: 1, isExactMatch: false };

  if (fullyQualifiedSymbol.indexOf('(') === -1) {
    return result;
  }

  // NOTE: The symbol may contain namespaces as symbols from the debug log are fully qualified e.g myns.MyClass.InnerClass.method(args)
  // We are attempting rudamentary handling of the case where symbols contain namespace but the parsed class does not but no guarantees it work in all cases.

  // There are two possible symbol types method and constructor, args are optional
  // MyClass.method(args) - method,  MyClass.InnerClass.method(args) - method
  // MyClass(args) - constuctor, MyClass.InnerClass(args) - constuctor

  // Find the Namespace of the supplied symbol, if there is one.
  //  strip all whitespace to make comparisons easier
  let symbolToFind = normalizeText(fullyQualifiedSymbol);
  const outerClassNode = rootNode.children?.[0];
  let outerClassName = normalizeText(outerClassNode?.name ?? '');
  const endNsIndex = symbolToFind.indexOf(outerClassName);
  const namespace = endNsIndex > 0 ? symbolToFind.slice(0, endNsIndex - 1) : '';
  if (namespace) {
    outerClassName = namespace + '.' + outerClassName;
    // Remove the leading namespace as most likely the source code will not have it, for symbols in this file.
    symbolToFind = symbolToFind.replace(namespace + '.', '');
  }

  // This is the index of the first '(' which indicates method args or constructor args.
  const methodArgsIndex = symbolToFind.indexOf('(');
  // We can't tell the difference between InnerClass constructor and outer class method call.
  // As such className could either be the class name or the method name, we need to check.
  const className = symbolToFind.slice(0, methodArgsIndex);
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

  // This is the method name before the args list, this may actually be a class name though so we need to check.
  // e.g for MyClass.InnerClass(args) we get InnerClass(args) but is this a method of InnerClass constructor?
  const qualifiedMethodName = symbolToFind.slice(className.lastIndexOf('.') + 1);
  if (qualifiedMethodName && currentRoot) {
    let methodNode: ApexMethodNode | ApexConstructorNode | undefined = findMethodNode(
      currentRoot,
      qualifiedMethodName,
      outerClassName,
    );
    if (!methodNode) {
      methodNode = findConstructorNode(currentRoot, qualifiedMethodName, outerClassName);
    }

    if (methodNode) {
      result.line = methodNode.line;
      result.character = methodNode.idCharacter;
      result.isExactMatch = true;
      return result;
    }
  }

  result.line = currentRoot.line ?? 1;
  result.isExactMatch = false;
  // keep the original case for error messages.
  result.missingSymbol = fullyQualifiedSymbol.slice(className.lastIndexOf('.') + 1);
  return result;
}

function findClassNode(root: ApexNode, symbol: string, namespace: string): ApexNode | undefined {
  const symbolWithoutNamespace = symbol.replaceAll(namespace + '.', '');
  return root.children?.find((child) => {
    if (child.nature === 'Class') {
      const normalizedChildName = normalizeText(child.name ?? '');
      return normalizedChildName === symbol || normalizedChildName === symbolWithoutNamespace;
    }

    return false;
  });
}

function findMethodNode(
  root: ApexNode,
  symbol: string,
  outerClassName: string,
): ApexMethodNode | undefined {
  const [methodName, params = ''] = symbol.slice(0, -1).split('(');
  // Try again but with the class name removed from args list. args from the debug log are fully qualified but they are not necessarily in the file,
  // as we only need to qualify for external types to the file.
  // (MyClass.ObjectArg) vs (ObjectArg) where MyClass is current class.
  const paramsWithoutClassName = params.replaceAll(outerClassName + '.', '');

  return root.children?.find((child) => {
    if (child.nature === 'Method' && normalizeText(child.name ?? '') === methodName) {
      const methodChild = child as ApexMethodNode;
      const methodParams = normalizeText(methodChild.params);
      return (
        params === undefined || methodParams === params || methodParams === paramsWithoutClassName
      );
    }
    return false;
  }) as ApexMethodNode;
}

function findConstructorNode(
  root: ApexNode,
  symbol: string,
  outerClassName: string,
): ApexConstructorNode | undefined {
  const [constructorName, params = ''] = symbol.slice(0, -1).split('(');
  // Try again but with the class name removed from args list. args from the debug log are fully qualified but they are not necessarily in the file,
  // as we only need to qualify for external types to the file.
  // (MyClass.ObjectArg) vs (ObjectArg) where MyClass is current class.
  const paramsWithoutClassName = params.replaceAll(outerClassName + '.', '');

  return root.children?.find((child) => {
    if (child.nature === 'Constructor' && normalizeText(child.name ?? '') === constructorName) {
      const constructorChild = child as ApexConstructorNode;
      const constructorParams = normalizeText(constructorChild.params);
      return (
        params === undefined ||
        constructorParams === params ||
        constructorParams === paramsWithoutClassName
      );
    }
    return false;
  }) as ApexConstructorNode;
}

function normalizeText(text: string): string {
  return text?.replaceAll(' ', '').toLowerCase();
}
