/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { getMethodLine, parseApex } from '../ApexParser/ApexSymbolLocator';
import { ApexVisitor, type ApexNode } from '../ApexParser/ApexVisitor';

jest.mock('../ApexParser/ApexVisitor');
jest.mock('@apexdevtools/apex-parser');
jest.mock('antlr4ts');

describe('ApexSymbolLocator', () => {
  const mockAST = {
    nature: 'Class',
    name: 'MyClass',
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
        nature: 'Class',
        name: 'Inner',
        children: [
          {
            nature: 'Method',
            name: 'bar',
            params: 'Integer',
            line: 6,
          },
        ],
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
      const line = getMethodLine(root, ['MyClass', 'foo()']);
      expect(line).toBe(2);
    });

    it('should find method line for method with params', () => {
      const line = getMethodLine(root, ['MyClass', 'bar(Integer)']);
      expect(line).toBe(3);
    });

    it('should find method line for overloaded method', () => {
      const line = getMethodLine(root, ['MyClass', 'bar(Integer, Integer)']);
      expect(line).toBe(4);
    });

    it('should find method line for inner class method', () => {
      const line = getMethodLine(root, ['MyClass', 'Inner', 'bar(Integer)']);
      expect(line).toBe(6);
    });

    it('should handle symbol not found', () => {
      const line = getMethodLine(root, ['MyClass', 'notFound()']);
      expect(line).toBe(1);
    });

    it('should handle missing class', () => {
      const line = getMethodLine(root, ['NotAClass', 'foo()']);
      expect(line).toBe(1);
    });
  });
});
