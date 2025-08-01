import type {
  ApexParserVisitor,
  ClassDeclarationContext,
  FormalParametersContext,
  MethodDeclarationContext,
} from '@apexdevtools/apex-parser';
import type { ErrorNode, ParseTree, RuleNode, TerminalNode } from 'antlr4ts/tree';

export enum ApexNature {
  class = 'Class',
  method = 'Method',
}

type ApexMemberNature = ApexNature.class | ApexNature.method;

export interface ApexNode {
  nature?: ApexMemberNature;
  name?: string;
  children?: ApexNode[];
  line?: number;
}

export type ApexMethodNode = ApexNode & {
  nature: ApexNature.method;
  params: string;
  line: number;
};

type VisitableApex = ParseTree & {
  accept<Result>(visitor: ApexParserVisitor<Result>): Result;
};

export class ApexVisitor implements ApexParserVisitor<ApexNode> {
  visit(ctx: ParseTree): ApexNode {
    return ctx ? (ctx as VisitableApex).accept(this) : {};
  }

  visitChildren(ctx: RuleNode): ApexNode {
    const children: ApexNode[] = [];

    for (let index = 0; index < ctx.childCount; index++) {
      const child = ctx.getChild(index);
      const node = this.visit(child);
      if (!node) {
        continue;
      }

      this.forNode(node, (anon) => children.push(anon));
    }

    return { children };
  }

  visitClassDeclaration(ctx: ClassDeclarationContext): ApexNode {
    return {
      nature: ApexNature.class,
      name: ctx.id().Identifier()?.toString() ?? '',
      children: ctx.children?.length ? this.visitChildren(ctx).children : [],
    };
  }

  visitMethodDeclaration(ctx: MethodDeclarationContext): ApexMethodNode {
    return {
      nature: ApexNature.method,
      name: ctx.id().Identifier()?.toString() ?? '',
      children: ctx.children?.length ? this.visitChildren(ctx).children : [],
      params: this.getParameters(ctx.formalParameters()),
      line: ctx.start.line,
    };
  }

  visitTerminal(_ctx: TerminalNode): ApexNode {
    return {};
  }

  visitErrorNode(_ctx: ErrorNode): ApexNode {
    return {};
  }

  private getParameters(ctx: FormalParametersContext): string {
    const paramsList = ctx.formalParameterList()?.formalParameter();
    return paramsList?.map((param) => param.typeRef().typeName(0)?.text).join(', ') ?? '';
  }

  private forNode(node: ApexNode, anonHandler: (n: ApexNode) => void) {
    if (this.isAnonNode(node)) {
      anonHandler(node);
    } else if (node.children?.length) {
      node.children.forEach((child) => anonHandler(child));
    }
  }

  private isAnonNode(node: ApexNode) {
    return node.nature !== null;
  }
}
