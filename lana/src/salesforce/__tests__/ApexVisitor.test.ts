/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApexVisitor, type ApexNode } from '../ApexParser/ApexVisitor';

vi.mock('@apexdevtools/apex-parser', () => ({ ApexParserBaseVisitor: class {} }));

type ClassDeclarationCtx = Parameters<ApexVisitor['visitClassDeclaration']>[0];
type MethodDeclarationCtx = Parameters<ApexVisitor['visitMethodDeclaration']>[0];
type ConstructorDeclarationCtx = Parameters<ApexVisitor['visitConstructorDeclaration']>[0];
type TerminalCtx = Parameters<ApexVisitor['visitTerminal']>[0];
type ErrorNodeCtx = Parameters<ApexVisitor['visitErrorNode']>[0];
type VisitCtx = Parameters<ApexVisitor['visit']>[0];
type RuleNodeCtx = Parameters<ApexVisitor['visitChildren']>[0];

interface DeclarationShape {
  name?: string | null;
  column?: number | null;
  line?: number;
  params?: string[];
  children?: unknown[];
}

function formalParameters(params: string[] | undefined) {
  return () => ({
    formalParameterList: () =>
      params && {
        formalParameter_list: () =>
          params.map((type) => ({ typeRef: () => ({ getText: () => type }) })),
      },
  });
}

function classCtx({ name = 'MyClass', column = 0, line = 1, children = [] }: DeclarationShape) {
  return {
    id: () => ({ getText: () => name, start: { column } }),
    children,
    start: { line },
  } as unknown as ClassDeclarationCtx;
}

function methodCtx({
  name = 'myMethod',
  column = 0,
  line = 1,
  params,
  children = [],
}: DeclarationShape) {
  return {
    id: () => ({ getText: () => name, start: { column } }),
    children,
    formalParameters: formalParameters(params),
    start: { line },
  } as unknown as MethodDeclarationCtx;
}

function constructorCtx(
  ids: Array<string | null>,
  { column = 0, line = 1, params, children = [] }: DeclarationShape = {},
) {
  return {
    qualifiedName: () => ({ id_list: () => ids.map((id) => ({ getText: () => id })) }),
    children,
    formalParameters: formalParameters(params),
    start: { line, column },
  } as unknown as ConstructorDeclarationCtx;
}

/** A rule whose children visit to `results`, in order. */
function ruleCtx(...results: unknown[]): RuleNodeCtx {
  return {
    getChildCount: () => results.length,
    getChild: (index: number) => ({ accept: () => results[index] }),
  } as unknown as RuleNodeCtx;
}

describe('ApexVisitor', () => {
  let visitor: ApexVisitor;
  const visited: ApexNode = { nature: 'Method', name: 'foo' };

  beforeEach(() => {
    visitor = new ApexVisitor();
  });

  /** Declarations take their children from visitChildren, which has its own tests below. */
  const stubVisitChildren = () => {
    visitor.visitChildren = vi
      .fn<typeof visitor.visitChildren>()
      .mockReturnValue({ children: [visited] });
  };

  describe('visitClassDeclaration', () => {
    it('builds a class node from its id, line and visited children', () => {
      stubVisitChildren();
      const node = visitor.visitClassDeclaration(
        classCtx({ name: 'MyClass', column: 4, line: 5, children: [{}] }),
      );

      expect(node).toEqual({
        nature: 'Class',
        name: 'MyClass',
        line: 5,
        idCharacter: 4,
        children: [visited],
      });
    });

    it('falls back to an empty name and column 0', () => {
      const node = visitor.visitClassDeclaration(classCtx({ name: null, column: null }));
      expect(node).toMatchObject({ name: '', idCharacter: 0 });
    });

    it('gives a class with no children an empty list', () => {
      const node = visitor.visitClassDeclaration(classCtx({ children: undefined }));
      expect(node.children).toEqual([]);
    });
  });

  describe('visitMethodDeclaration', () => {
    it('builds a method node with its param types joined', () => {
      stubVisitChildren();
      const node = visitor.visitMethodDeclaration(
        methodCtx({
          name: 'myMethod',
          column: 2,
          line: 42,
          params: ['Integer', 'String'],
          children: [{}],
        }),
      );

      expect(node).toEqual({
        nature: 'Method',
        name: 'myMethod',
        params: 'Integer,String',
        line: 42,
        idCharacter: 2,
        children: [visited],
      });
    });

    it('falls back to an empty name, column 0 and no params', () => {
      const node = visitor.visitMethodDeclaration(methodCtx({ name: null, column: null }));
      expect(node).toMatchObject({ name: '', idCharacter: 0, params: '' });
    });
  });

  describe('visitConstructorDeclaration', () => {
    it('names the constructor by the last qualified id', () => {
      stubVisitChildren();
      const node = visitor.visitConstructorDeclaration(
        constructorCtx(['OuterClass', 'MyConstructor'], {
          column: 5,
          line: 20,
          params: ['String', 'Integer'],
          children: [{}],
        }),
      );

      expect(node).toEqual({
        nature: 'Constructor',
        name: 'MyConstructor',
        params: 'String,Integer',
        line: 20,
        idCharacter: 5,
        children: [visited],
      });
    });

    it('falls back to an empty name, column 0 and no params', () => {
      const node = visitor.visitConstructorDeclaration(constructorCtx([null], { column: null }));
      expect(node).toMatchObject({ name: '', idCharacter: 0, params: '' });
    });
  });

  it('adds no node for a terminal or an error node', () => {
    expect(visitor.visitTerminal({} as TerminalCtx)).toEqual({});
    expect(visitor.visitErrorNode({} as ErrorNodeCtx)).toEqual({});
  });

  describe('visit', () => {
    it.each([null, undefined])('returns an empty node for %p', (ctx) => {
      expect(visitor.visit(ctx as unknown as VisitCtx)).toEqual({});
    });

    it('delegates to the context', () => {
      const accept = vi.fn().mockReturnValue({ nature: 'Method', name: 'test' });

      expect(visitor.visit({ accept } as unknown as VisitCtx)).toEqual({
        nature: 'Method',
        name: 'test',
      });
      expect(accept).toHaveBeenCalledWith(visitor);
    });
  });

  describe('visitChildren', () => {
    it.each([null, undefined])('skips a child that visits to %p', (empty) => {
      expect(visitor.visitChildren(ruleCtx(empty, visited)).children).toEqual([visited]);
    });

    it('keeps declarations and lifts a wrapper’s children, in order', () => {
      const myClass: ApexNode = { nature: 'Class', name: 'MyClass' };
      const nested: ApexNode = { nature: 'Method', name: 'nested' };

      const { children } = visitor.visitChildren(ruleCtx(myClass, { children: [nested, visited] }));

      expect(children).toEqual([myClass, nested, visited]);
    });

    it.each([
      ['an empty child list', { children: [] }],
      ['no child list', { name: 'wrapper' }],
    ])('adds nothing for a wrapper with %s', (_label, wrapper) => {
      expect(visitor.visitChildren(ruleCtx(wrapper)).children).toEqual([]);
    });
  });
});
