/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type {
  ApexParserVisitor,
  ClassDeclarationContext,
  FormalParametersContext,
  MethodDeclarationContext,
} from '@apexdevtools/apex-parser';
import type { ErrorNode, ParseTree, RuleNode, TerminalNode } from 'antlr4ts/tree';

type ApexNature = 'Class' | 'Method';

/**
 * Represents a node in the Apex syntax tree.
 * Can be either a class or method declaration with optional child nodes.
 */
export interface ApexNode {
  /** The type of Apex construct (Class or Method) */
  nature?: ApexNature;
  /** The name of the class or method, in lower case */
  name?: string;
  /** Child nodes (nested classes or methods) */
  children?: ApexNode[];
  /** Line number where the node is declared */
  line?: number;
  /** Character position of the identifier on the line */
  idCharacter?: number;
}

/**
 * Represents a class declaration node in the Apex syntax tree.
 * All properties are required (non-optional) to ensure complete class metadata.
 */
export interface ApexClassNode extends ApexNode {
  /** Indicates this node represents a class declaration */
  nature: 'Class';
  /** Line number where the class is declared */
  line: number;
  /** Character position of the class identifier on the line */
  idCharacter: number;
}

/**
 * Represents a method declaration node in the Apex syntax tree.
 * All properties are required (non-optional) to ensure complete method metadata.
 */
export interface ApexMethodNode extends ApexNode {
  /** Indicates this node represents a method declaration */
  nature: 'Method';
  /** Comma-separated list of parameter types for the method */
  params: string;
  /** Line number where the method is declared */
  line: number;
  /** Character position of the method identifier on the line */
  idCharacter: number;
}

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

  visitClassDeclaration(ctx: ClassDeclarationContext): ApexClassNode {
    const { start } = ctx;
    const ident = ctx.id();

    return {
      nature: 'Class',
      name: ident.text.toLowerCase(),
      children: ctx.children?.length ? this.visitChildren(ctx).children : [],
      line: start.line,
      idCharacter: ident.start.charPositionInLine ?? 0,
    };
  }

  visitMethodDeclaration(ctx: MethodDeclarationContext): ApexMethodNode {
    const { start } = ctx;
    const ident = ctx.id();

    return {
      nature: 'Method',
      name: ident.text.toLowerCase(),
      children: ctx.children?.length ? this.visitChildren(ctx).children : [],
      params: this.getParameters(ctx.formalParameters()),
      line: start.line,
      idCharacter: ident.start.charPositionInLine,
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
    return (
      paramsList
        ?.map((param) => param.typeRef().text.replaceAll(' ', '').toLowerCase())
        .join(',') ?? ''
    );
  }

  private forNode(node: ApexNode, anonHandler: (n: ApexNode) => void) {
    if (this.isAnonNode(node)) {
      anonHandler(node);
    } else if (node.children?.length) {
      node.children.forEach((child) => anonHandler(child));
    }
  }

  private isAnonNode(node: ApexNode) {
    return !!node.nature;
  }
}
