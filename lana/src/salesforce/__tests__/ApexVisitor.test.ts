/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/naming-convention */
import { ApexVisitor } from '../ApexParser/ApexVisitor';

describe('ApexVisitor', () => {
  let visitor: ApexVisitor;

  beforeEach(() => {
    visitor = new ApexVisitor();
  });

  describe('visitClassDeclaration', () => {
    it('should use empty string when ident getText returns null', () => {
      const ctx = {
        id: () => ({
          getText: () => null,
          start: { column: 5 },
        }),
        children: [],
        start: { line: 1 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitClassDeclaration(ctx as any);

      expect(node.name).toBe('');
    });

    it('should use 0 when column is null', () => {
      const ctx = {
        id: () => ({
          getText: () => 'MyClass',
          start: { column: null },
        }),
        children: [],
        start: { line: 1 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitClassDeclaration(ctx as any);

      expect(node.idCharacter).toBe(0);
    });

    it('should return class node with name and children', () => {
      const ctx = {
        id: () => ({
          getText: () => 'MyClass',
          start: { column: 0 },
        }),
        children: [{}],
        getChildCount: () => 1,
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
          getText: () => '',
          start: { column: 0 },
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
          getText: () => 'NoChildren',
          start: { column: 0 },
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
    it('should use empty string when ident getText returns null', () => {
      const ctx = {
        id: () => ({
          getText: () => null,
          start: { column: 5 },
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
    });

    it('should use 0 when column is null', () => {
      const ctx = {
        id: () => ({
          getText: () => 'myMethod',
          start: { column: null },
        }),
        children: [],
        formalParameters: () => ({
          formalParameterList: () => undefined,
        }),
        start: { line: 1 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitMethodDeclaration(ctx as any);

      expect(node.idCharacter).toBe(0);
    });

    it('should return method node with name, params, and line', () => {
      const ctx = {
        id: () => ({
          getText: () => 'myMethod',
          start: { column: 2 },
        }),
        children: [{}],
        formalParameters: () => ({
          formalParameterList: () => ({
            formalParameter_list: () => [
              { typeRef: () => ({ getText: () => 'Integer' }) },
              { typeRef: () => ({ getText: () => 'String' }) },
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
          getText: () => '',
          start: { column: 0 },
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
    it('should use empty string when constructorName getText returns null', () => {
      const ctx = {
        qualifiedName: () => ({
          id_list: () => [{ getText: () => null }],
        }),
        children: [],
        formalParameters: () => ({
          formalParameterList: () => undefined,
        }),
        start: { line: 1, column: 5 },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitConstructorDeclaration(ctx as any);

      expect(node.name).toBe('');
    });

    it('should use 0 when start.column is null', () => {
      const ctx = {
        qualifiedName: () => ({
          id_list: () => [{ getText: () => 'MyConstructor' }],
        }),
        children: [],
        formalParameters: () => ({
          formalParameterList: () => undefined,
        }),
        start: { line: 1, column: null },
      };
      visitor.visitChildren = jest.fn().mockReturnValue({ children: [] });

      const node = visitor.visitConstructorDeclaration(ctx as any);

      expect(node.idCharacter).toBe(0);
    });

    it('should return constructor node with name, params, and line', () => {
      const ctx = {
        qualifiedName: () => ({
          id_list: () => [{ getText: () => 'OuterClass' }, { getText: () => 'MyConstructor' }],
        }),
        children: [{}],
        formalParameters: () => ({
          formalParameterList: () => ({
            formalParameter_list: () => [
              { typeRef: () => ({ getText: () => 'String' }) },
              { typeRef: () => ({ getText: () => 'Integer' }) },
            ],
          }),
        }),
        start: { line: 20, column: 5 },
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
          id_list: () => [{ getText: () => 'MyClass' }],
        }),
        children: [],
        formalParameters: () => ({
          formalParameterList: () => undefined,
        }),
        start: { line: 10, column: 2 },
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
          id_list: () => [
            { getText: () => 'OuterClass' },
            { getText: () => 'InnerClass' },
            { getText: () => 'InnerClass' },
          ],
        }),
        children: [{}],
        formalParameters: () => ({
          formalParameterList: () => ({
            formalParameter_list: () => [{ typeRef: () => ({ getText: () => 'Boolean' }) }],
          }),
        }),
        start: { line: 35, column: 10 },
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

  describe('visit', () => {
    it('should return empty object when ctx is null', () => {
      expect(visitor.visit(null as any)).toEqual({});
    });

    it('should return empty object when ctx is undefined', () => {
      expect(visitor.visit(undefined as any)).toEqual({});
    });

    it('should call accept on context when ctx exists', () => {
      const mockAccept = jest.fn().mockReturnValue({ nature: 'Method', name: 'test' });
      const ctx = { accept: mockAccept };

      const result = visitor.visit(ctx as any);

      expect(mockAccept).toHaveBeenCalledWith(visitor);
      expect(result).toEqual({ nature: 'Method', name: 'test' });
    });
  });

  describe('visitChildren', () => {
    it('should skip null nodes returned from visit', () => {
      const ctx = {
        getChildCount: () => 2,
        getChild: jest.fn().mockImplementation((index: number) => ({
          accept: jest.fn().mockReturnValue(index === 0 ? null : { nature: 'Method', name: 'foo' }),
        })),
      };

      const result = visitor.visitChildren(ctx as any);

      expect(result.children).toHaveLength(1);
      expect(result.children![0]).toEqual({ nature: 'Method', name: 'foo' });
    });

    it('should skip undefined nodes returned from visit', () => {
      const ctx = {
        getChildCount: () => 2,
        getChild: jest.fn().mockImplementation((index: number) => ({
          accept: jest
            .fn()
            .mockReturnValue(index === 0 ? undefined : { nature: 'Method', name: 'bar' }),
        })),
      };

      const result = visitor.visitChildren(ctx as any);

      expect(result.children).toHaveLength(1);
      expect(result.children![0]).toEqual({ nature: 'Method', name: 'bar' });
    });

    it('should process multiple valid nodes', () => {
      const ctx = {
        getChildCount: () => 3,
        getChild: jest.fn().mockImplementation((index: number) => ({
          accept: jest.fn().mockReturnValue({ nature: 'Method', name: `method${index}` }),
        })),
      };

      const result = visitor.visitChildren(ctx as any);

      expect(result.children).toHaveLength(3);
    });

    it('should flatten children from non-anon nodes (nodes without nature)', () => {
      // A node without 'nature' should have its children extracted
      const ctx = {
        getChildCount: () => 1,
        getChild: jest.fn().mockReturnValue({
          accept: jest.fn().mockReturnValue({
            // No nature property - this is a "non-anon" wrapper node
            children: [
              { nature: 'Method', name: 'nested1' },
              { nature: 'Method', name: 'nested2' },
            ],
          }),
        }),
      };

      const result = visitor.visitChildren(ctx as any);

      // The children should be flattened
      expect(result.children).toHaveLength(2);
      expect(result.children![0]).toEqual({ nature: 'Method', name: 'nested1' });
      expect(result.children![1]).toEqual({ nature: 'Method', name: 'nested2' });
    });

    it('should handle non-anon nodes with empty children array', () => {
      const ctx = {
        getChildCount: () => 1,
        getChild: jest.fn().mockReturnValue({
          accept: jest.fn().mockReturnValue({
            // No nature, empty children
            children: [],
          }),
        }),
      };

      const result = visitor.visitChildren(ctx as any);

      expect(result.children).toHaveLength(0);
    });

    it('should handle non-anon nodes with no children property', () => {
      const ctx = {
        getChildCount: () => 1,
        getChild: jest.fn().mockReturnValue({
          accept: jest.fn().mockReturnValue({
            // No nature, no children property
            name: 'wrapper',
          }),
        }),
      };

      const result = visitor.visitChildren(ctx as any);

      // Node is not anon (no nature) and has no children, so nothing added
      expect(result.children).toHaveLength(0);
    });

    it('should handle mix of anon and non-anon nodes', () => {
      const ctx = {
        getChildCount: () => 2,
        getChild: jest.fn().mockImplementation((index: number) => ({
          accept: jest.fn().mockReturnValue(
            index === 0
              ? { nature: 'Class', name: 'MyClass' } // Anon node (has nature)
              : {
                  // Non-anon node (no nature)
                  children: [{ nature: 'Method', name: 'nested' }],
                },
          ),
        })),
      };

      const result = visitor.visitChildren(ctx as any);

      expect(result.children).toHaveLength(2);
      expect(result.children![0]).toEqual({ nature: 'Class', name: 'MyClass' });
      expect(result.children![1]).toEqual({ nature: 'Method', name: 'nested' });
    });
  });
});
