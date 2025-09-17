/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { getMethodLine, parseApex } from '../ApexParser/ApexSymbolLocator';
import { ApexVisitor, type ApexNode } from '../ApexParser/ApexVisitor';

jest.mock('../ApexParser/ApexVisitor');
jest.mock('@apexdevtools/apex-parser');

describe('ApexSymbolLocator', () => {
  const mockAST = {
    nature: 'Class',
    name: 'MyClass',
    line: 1,
    children: [
      {
        nature: 'Method',
        name: 'foo',
        params: '',
        line: 2,
      },
      {
        nature: 'Method',
        name: 'bar',
        params: 'Integer',
        line: 3,
      },
      {
        nature: 'Method',
        name: 'bar',
        params: 'Integer, Integer',
        line: 4,
      },
      {
        nature: 'Method',
        name: 'baz',
        params: 'MyClass.Inner, MyClass.InnerTwo',
        line: 5,
      },
      {
        nature: 'Class',
        name: 'Inner',
        line: 6,
        children: [
          {
            nature: 'Method',
            name: 'bar',
            params: 'Integer',
            line: 7,
          },
        ],
      },
      {
        nature: 'Class',
        name: 'InnerTwo',
        line: 8,
      },
    ],
  };

  beforeEach(() => {
    (ApexVisitor as jest.MockedClass<typeof ApexVisitor>).mockImplementation(() => {
      return {
        visit: jest.fn().mockReturnValue(mockAST),
        visitChildren: jest.fn(),
        visitClassDeclaration: jest.fn(),
        visitMethodDeclaration: jest.fn(),
        visitTerminal: jest.fn(),
        visitErrorNode: jest.fn(),
        visitTriggerDeclaration: jest.fn(),
        visitInterfaceDeclaration: jest.fn(),
      } as unknown as ApexVisitor;
    });
  });

  describe('getMethodLine', () => {
    let root: ApexNode;

    beforeEach(() => {
      root = parseApex('');
    });

    it('should find method line for top-level method', () => {
      const result = getMethodLine(root, ['MyClass', 'foo()']);
      expect(result.line).toBe(2);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find method line for method with params', () => {
      const result = getMethodLine(root, ['MyClass', 'bar(Integer)']);
      expect(result.line).toBe(3);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find method line for overloaded method', () => {
      const result = getMethodLine(root, ['MyClass', 'bar(Integer, Integer)']);
      expect(result.line).toBe(4);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find method line for inner class method', () => {
      const result = getMethodLine(root, ['MyClass', 'Inner', 'bar(Integer)']);
      expect(result.line).toBe(7);
      expect(result.isExactMatch).toBe(true);
    });

    it('should handle symbol not found', () => {
      const result = getMethodLine(root, ['MyClass', 'notFound()']);
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('notFound()');
    });

    it('should handle symbol not found on inner class', () => {
      const result = getMethodLine(root, ['MyClass', 'Inner', 'notFound()']);
      expect(result.line).toBe(6);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('notFound()');
    });

    it('should handle missing class', () => {
      const result = getMethodLine(root, ['NotAClass', 'foo()']);
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('NotAClass');
    });
  });

  describe('fuzzy parameter matching', () => {
    let root: ApexNode;

    beforeEach(() => {
      root = parseApex('');
    });

    it('should find method when fully qualified inner class passed', () => {
      const result = getMethodLine(root, ['MyClass', 'baz(MyClass.Inner, MyClass.InnerTwo)']);
      expect(result.line).toBe(5);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find method when short form passed', () => {
      const result = getMethodLine(root, ['MyClass', 'baz(Inner, InnerTwo)']);
      expect(result.line).toBe(5);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find method when mixed fully qualified and short form passed', () => {
      const result = getMethodLine(root, ['MyClass', 'baz(MyClass.Inner, InnerTwo)']);
      expect(result.line).toBe(5);
      expect(result.isExactMatch).toBe(true);
    });
  });
});
