/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import {
  ApexParserBaseVisitor,
  type ApexErrorNode,
  type ApexParserRuleContext,
  type ApexParseTree,
  type ApexTerminalNode,
  type ClassDeclarationContext,
  type ConstructorDeclarationContext,
  type FormalParametersContext,
  type MethodDeclarationContext,
} from '@apexdevtools/apex-parser';

type ApexNature = 'Constructor' | 'Class' | 'Method';

/**
 * Represents a node in the Apex syntax tree.
 * Can be either a class or method declaration with optional child nodes.
 */
export interface ApexNode {
  /** The type of Apex construct (Class or Method) */
  nature?: ApexNature;
  /** The name of the class or method */
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

export interface ApexParamNode extends ApexNode {
  /** Indicates this node represents a method declaration */
  nature: 'Method' | 'Constructor';
  /** Comma-separated list of parameter types for the method */
  params: string;
  /** Line number where the method is declared */
  line: number;
  /** Character position of the method identifier on the line */
  idCharacter: number;
}

/**
 * Represents a method declaration node in the Apex syntax tree.
 * All properties are required (non-optional) to ensure complete method metadata.
 */
export interface ApexMethodNode extends ApexParamNode {
  /** Indicates this node represents a method declaration */
  nature: 'Method';
}

export interface ApexConstructorNode extends ApexParamNode {
  /** Indicates this node represents a method declaration */
  nature: 'Constructor';
}

export class ApexVisitor extends ApexParserBaseVisitor<ApexNode> {
  override visit(ctx: ApexParseTree): ApexNode {
    if (!ctx) {
      return {};
    }
    return super.visit(ctx);
  }

  override visitChildren(ctx: ApexParserRuleContext): ApexNode {
    const children: ApexNode[] = [];

    for (let index = 0; index < ctx.getChildCount(); index++) {
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
      name: ident.getText() ?? '',
      children: ctx.children?.length ? this.visitChildren(ctx).children : [],
      line: start.line,
      idCharacter: ident.start.column ?? 0,
    };
  }

  visitConstructorDeclaration(ctx: ConstructorDeclarationContext): ApexConstructorNode {
    const { start } = ctx;
    const idContexts = ctx.qualifiedName().id_list();
    const constructorName = idContexts[idContexts.length - 1];

    return {
      nature: 'Constructor',
      name: constructorName?.getText() ?? '',
      children: ctx.children?.length ? this.visitChildren(ctx).children : [],
      params: this.getParameters(ctx.formalParameters()),
      line: start.line,
      idCharacter: start.column ?? 0,
    };
  }

  visitMethodDeclaration(ctx: MethodDeclarationContext): ApexMethodNode {
    const { start } = ctx;
    const ident = ctx.id();

    return {
      nature: 'Method',
      name: ident.getText() ?? '',
      children: ctx.children?.length ? this.visitChildren(ctx).children : [],
      params: this.getParameters(ctx.formalParameters()),
      line: start.line,
      idCharacter: ident.start.column ?? 0,
    };
  }

  override visitTerminal(_ctx: ApexTerminalNode): ApexNode {
    return {};
  }

  override visitErrorNode(_ctx: ApexErrorNode): ApexNode {
    return {};
  }

  private getParameters(ctx: FormalParametersContext): string {
    const paramsList = ctx.formalParameterList()?.formalParameter_list();
    return paramsList?.map((param) => param.typeRef().getText()).join(',') ?? '';
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
