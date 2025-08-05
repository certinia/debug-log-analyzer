/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { ApexNature, ApexVisitor } from '../ApexParser/ApexVisitor';

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
          Identifier: () => ({ toString: () => 'MyClass' }),
        }),
        children: [{}],
        get childCount() {
          return 1;
        },
        getChild: jest.fn().mockReturnValue({
          accept: jest.fn().mockReturnValue({ nature: ApexNature.method, name: 'foo' }),
        }),
      };
      visitor.visitChildren = jest
        .fn()
        .mockReturnValue({ children: [{ nature: ApexNature.method, name: 'foo' }] });

      const node = visitor.visitClassDeclaration(ctx as any);

      expect(node.nature).toBe(ApexNature.class);
      expect(node.name).toBe('MyClass');
      expect(node.children).toEqual([{ nature: ApexNature.method, name: 'foo' }]);
    });

    it('should handle missing Identifier', () => {
      const ctx = {
        id: () => ({
          Identifier: () => undefined,
        }),
        children: [],
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitClassDeclaration(ctx as any);

      expect(node.name).toBe('');
    });

    it('should handle missing children', () => {
      const ctx = {
        id: () => ({
          Identifier: () => ({ toString: () => 'NoChildren' }),
        }),
        children: undefined,
      };

      const node = visitor.visitClassDeclaration(ctx as any);

      expect(node.children).toEqual([]);
    });
  });

  describe('visitMethodDeclaration', () => {
    it('should return method node with name, params, and line', () => {
      const ctx = {
        id: () => ({
          Identifier: () => ({ toString: () => 'myMethod' }),
        }),
        children: [{}],
        formalParameters: () => ({
          formalParameterList: () => ({
            formalParameter: () => [
              { typeRef: () => ({ typeName: () => ({ text: 'Integer' }) }) },
              { typeRef: () => ({ typeName: () => ({ text: 'String' }) }) },
            ],
          }),
        }),
        start: { line: 42 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitMethodDeclaration(ctx as any);

      expect(node.nature).toBe(ApexNature.method);
      expect(node.name).toBe('myMethod');
      expect(node.params).toBe('Integer, String');
      expect(node.line).toBe(42);
    });

    it('should handle missing Identifier and params', () => {
      const ctx = {
        id: () => ({
          Identifier: () => undefined,
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
