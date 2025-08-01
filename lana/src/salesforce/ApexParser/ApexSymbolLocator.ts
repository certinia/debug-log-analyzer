import { ApexLexer, ApexParser, CaseInsensitiveInputStream } from '@apexdevtools/apex-parser';
import { CharStreams, CommonTokenStream } from 'antlr4ts';
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
  let line = 1;
  let currentRoot: ApexNode | undefined = rootNode;

  symbols.forEach((symbol) => {
    if (!currentRoot) {
      return;
    }

    if (!symbol.includes('(')) {
      currentRoot =
        findNodesByProperties(currentRoot, { name: symbol, nature: ApexNature.class })[0] ??
        undefined;
    } else {
      const [methodName, params] = symbol.split('(');
      line =
        findNodesByProperties(currentRoot, {
          name: methodName,
          nature: ApexNature.method,
          params: params?.replace(')', '').trim(),
        })[0]?.line ?? 1;
    }
  });

  return line;
}

function findNodesByProperties(
  root: ApexNode,
  props: Partial<ApexNode | ApexMethodNode>,
): ApexNode[] {
  const matches: ApexNode[] = [];

  function isMatch(node: ApexNode): boolean {
    for (const key in props) {
      const typedKey = key as keyof (ApexNode | ApexMethodNode);
      if (props[typedKey] !== undefined && node[typedKey] !== props[typedKey]) {
        return false;
      }
    }

    return true;
  }

  function traverse(node: ApexNode) {
    if (isMatch(node)) {
      matches.push(node);
    }
    node.children?.forEach(traverse);
  }

  traverse(root);

  return matches;
}
