/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { ApexVisitor } from '../ApexParser/ApexVisitor';

jest.mock('@apexdevtools/apex-parser');
jest.mock('antlr4ts/tree');

describe('ApexVisitor', () => {
  let visitor: ApexVisitor;

  beforeEach(() => {
    visitor = new ApexVisitor();
  });

  describe('visitClassDeclaration', () => {
    it('should return class node with name and children', () => {
      const ctx = {
        id: () => ({
          text: 'MyClass',
          start: { charPositionInLine: 0 },
        }),
        children: [{}],
        get childCount() {
          return 1;
        },
        getChild: jest.fn().mockReturnValue({
          accept: jest.fn().mockReturnValue({ nature: 'Method', name: 'foo' }),
        }),
        start: { line: 5 },
      };
      visitor.visitChildren = jest
        .fn()
        .mockReturnValue({ children: [{ nature: 'Method', name: 'foo' }] });

      const node = visitor.visitClassDeclaration(ctx as any);

      expect(node.nature).toBe('Class');
      expect(node.name).toBe('MyClass');
      expect(node.line).toBe(5);
      expect(node.children).toEqual([{ nature: 'Method', name: 'foo' }]);
    });

    it('should handle missing Identifier', () => {
      const ctx = {
        id: () => ({
          text: '',
          start: { charPositionInLine: 0 },
        }),
        children: [],
        start: { line: 10 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitClassDeclaration(ctx as any);

      expect(node.name).toBe('');
      expect(node.line).toBe(10);
    });

    it('should handle missing children', () => {
      const ctx = {
        id: () => ({
          text: 'NoChildren',
          start: { charPositionInLine: 0 },
        }),
        children: undefined,
        start: { line: 15 },
      };

      const node = visitor.visitClassDeclaration(ctx as any);

      expect(node.children).toEqual([]);
      expect(node.line).toBe(15);
    });
  });

  describe('visitMethodDeclaration', () => {
    it('should return method node with name, params, and line', () => {
      const ctx = {
        id: () => ({
          text: 'myMethod',
          start: { charPositionInLine: 2 },
        }),
        children: [{}],
        formalParameters: () => ({
          formalParameterList: () => ({
            formalParameter: () => [
              { typeRef: () => ({ text: 'Integer' }) },
              { typeRef: () => ({ text: 'String' }) },
            ],
          }),
        }),
        start: { line: 42 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitMethodDeclaration(ctx as any);

      expect(node.nature).toBe('Method');
      expect(node.name).toBe('myMethod');
      expect(node.params).toBe('Integer,String');
      expect(node.line).toBe(42);
    });

    it('should handle missing Identifier and params', () => {
      const ctx = {
        id: () => ({
          text: '',
          start: { charPositionInLine: 0 },
        }),
        children: [],
        formalParameters: () => ({
          formalParameterList: () => undefined,
        }),
        start: { line: 1 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitMethodDeclaration(ctx as any);

      expect(node.name).toBe('');
      expect(node.params).toBe('');
    });
  });

  describe('visitConstructorDeclaration', () => {
    it('should return constructor node with name, params, and line', () => {
      const ctx = {
        qualifiedName: () => ({
          id: () => [{ text: 'OuterClass' }, { text: 'MyConstructor' }],
        }),
        children: [{}],
        formalParameters: () => ({
          formalParameterList: () => ({
            formalParameter: () => [
              { typeRef: () => ({ text: 'String' }) },
              { typeRef: () => ({ text: 'Integer' }) },
            ],
          }),
        }),
        start: { line: 20, charPositionInLine: 5 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitConstructorDeclaration(ctx as any);

      expect(node.nature).toBe('Constructor');
      expect(node.name).toBe('MyConstructor');
      expect(node.params).toBe('String,Integer');
      expect(node.line).toBe(20);
      expect(node.idCharacter).toBe(5);
    });

    it('should handle constructor with no params', () => {
      const ctx = {
        qualifiedName: () => ({
          id: () => [{ text: 'MyClass' }],
        }),
        children: [],
        formalParameters: () => ({
          formalParameterList: () => undefined,
        }),
        start: { line: 10, charPositionInLine: 2 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitConstructorDeclaration(ctx as any);

      expect(node.nature).toBe('Constructor');
      expect(node.name).toBe('MyClass');
      expect(node.params).toBe('');
      expect(node.line).toBe(10);
    });

    it('should handle nested class constructor', () => {
      const ctx = {
        qualifiedName: () => ({
          id: () => [{ text: 'OuterClass' }, { text: 'InnerClass' }, { text: 'InnerClass' }],
        }),
        children: [{}],
        formalParameters: () => ({
          formalParameterList: () => ({
            formalParameter: () => [{ typeRef: () => ({ text: 'Boolean' }) }],
          }),
        }),
        start: { line: 35, charPositionInLine: 10 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitConstructorDeclaration(ctx as any);

      expect(node.nature).toBe('Constructor');
      expect(node.name).toBe('InnerClass');
      expect(node.params).toBe('Boolean');
      expect(node.line).toBe(35);
    });
  });

  describe('visitTerminal', () => {
    it('should return empty object', () => {
      expect(visitor.visitTerminal({} as any)).toEqual({});
    });
  });

  describe('visitErrorNode', () => {
    it('should return empty object', () => {
      expect(visitor.visitErrorNode({} as any)).toEqual({});
    });
  });
});
