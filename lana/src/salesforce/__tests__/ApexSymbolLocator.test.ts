/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { getMethodLine, parseApex } from '../ApexParser/ApexSymbolLocator';
import { ApexVisitor, type ApexNode } from '../ApexParser/ApexVisitor';

jest.mock('../ApexParser/ApexVisitor');
jest.mock('@apexdevtools/apex-parser');

describe('ApexSymbolLocator', () => {
  const mockAST = {
    children: [
      {
        nature: 'Class',
        name: 'myclass',
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
            params: 'integer',
            line: 3,
          },
          {
            nature: 'Method',
            name: 'bar',
            params: 'integer,integer',
            line: 4,
          },
          {
            nature: 'Method',
            name: 'bar',
            params: 'MyClass.InnerClass, InnerClass, integer,integer',
            line: 5,
          },
          {
            nature: 'Class',
            name: 'inner',
            line: 6,
            children: [
              {
                nature: 'Constructor',
                name: 'Inner',
                params: '',
                line: 7,
              },
              {
                nature: 'Constructor',
                name: 'Inner',
                params: 'String',
                line: 8,
              },
              {
                nature: 'Method',
                name: 'bar',
                params: 'integer',
                line: 9,
              },
            ],
          },
          {
            nature: 'Constructor',
            name: 'MyClass',
            params: '',
            line: 10,
          },
          {
            nature: 'Constructor',
            name: 'MyClass',
            params: 'string',
            line: 11,
          },
          {
            nature: 'Constructor',
            name: 'MyClass',
            params: 'string,integer',
            line: 12,
          },
          {
            nature: 'Constructor',
            name: 'MyClass',
            params: 'Map<Id, MyClass.InnerClass>, Map<Id, InnerClass>, String, Integer',
            line: 13,
          },
          {
            nature: 'Class',
            name: 'inner2',
            line: 14,
            children: [],
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
      const result = getMethodLine(root, 'MyClass.foo()');
      expect(result.line).toBe(2);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find method line for method with params', () => {
      const result = getMethodLine(root, 'MyClass.bar(Integer)');
      expect(result.line).toBe(3);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find method line for overloaded method', () => {
      const result = getMethodLine(root, 'MyClass.bar(Integer, Integer)');
      expect(result.line).toBe(4);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find method line for inner class method', () => {
      const result = getMethodLine(root, 'MyClass.Inner.bar(Integer)');
      expect(result.line).toBe(9);
      expect(result.isExactMatch).toBe(true);
    });

    it('should handle symbol not found', () => {
      const result = getMethodLine(root, 'MyClass.notFound()');
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('notFound()');
    });

    it('should handle symbol not found on inner class', () => {
      const result = getMethodLine(root, 'MyClass.Inner.notFound()');
      expect(result.line).toBe(6);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('notFound()');
    });

    it('should handle missing class', () => {
      const result = getMethodLine(root, 'NotAClass.foo()');
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('foo()');
    });
  });

  describe('getMethodLine - constructor cases', () => {
    let root: ApexNode;

    beforeEach(() => {
      root = parseApex('');
    });

    it('should find constructor with no parameters', () => {
      const result = getMethodLine(root, 'MyClass()');
      expect(result.line).toBe(10);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find constructor with single parameter', () => {
      const result = getMethodLine(root, 'MyClass(String)');
      expect(result.line).toBe(11);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find overloaded constructor with multiple parameters', () => {
      const result = getMethodLine(root, 'MyClass(String, Integer)');
      expect(result.line).toBe(12);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find overloaded constructor with multiple parameters + custom types', () => {
      const result = getMethodLine(
        root,
        'MyClass(Map<Id, MyClass.InnerClass>, Map<Id, InnerClass>, String, Integer)',
      );
      expect(result.line).toBe(13);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find overloaded constructor with multiple parameters + custom types but missing class prefix', () => {
      const result = getMethodLine(
        root,
        'MyClass(Map<Id, InnerClass>, Map<Id, MyClass.InnerClass>, String, Integer)',
      );
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
    });

    it('should find inner constructors', () => {
      let result = getMethodLine(root, 'MyClass.inner()');
      expect(result.line).toBe(7);
      expect(result.isExactMatch).toBe(true);

      result = getMethodLine(root, 'MyClass.inner(string)');
      expect(result.line).toBe(8);
      expect(result.isExactMatch).toBe(true);
    });

    it('should handle constructor not found with wrong params', () => {
      const result = getMethodLine(root, 'MyClass(Boolean)');
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('MyClass(Boolean)');
    });

    it('should handle case-insensitive constructor lookup', () => {
      const result = getMethodLine(root, 'myclass()');
      expect(result.line).toBe(10);
      expect(result.isExactMatch).toBe(true);
    });

    it('should handle case-insensitive parameter type lookup', () => {
      const result = getMethodLine(root, 'MyClass(string)');
      expect(result.line).toBe(11);
      expect(result.isExactMatch).toBe(true);
    });
  });

  describe('getMethodLine - namespace cases', () => {
    let root: ApexNode;

    beforeEach(() => {
      root = parseApex('');
    });

    it('should find method with namespace prefix', () => {
      const result = getMethodLine(root, 'myns.MyClass.foo()');
      expect(result.line).toBe(2);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find constructor with namespace prefix', () => {
      const result = getMethodLine(root, 'myns.MyClass()');
      expect(result.line).toBe(10);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find inner class method with namespace', () => {
      const result = getMethodLine(root, 'myns.MyClass.Inner.bar(Integer)');
      expect(result.line).toBe(9);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find constructor with namespace and parameters', () => {
      const result = getMethodLine(root, 'myns.MyClass(String, Integer)');
      expect(result.line).toBe(12);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find overloaded method with namespace', () => {
      const result = getMethodLine(root, 'ns.MyClass.bar(Integer, Integer)');
      expect(result.line).toBe(4);
      expect(result.isExactMatch).toBe(true);
    });

    it('should handle missing method with namespace', () => {
      const result = getMethodLine(root, 'myns.MyClass.missing()');
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('lass.missing()');
    });

    it('should handle namespace with missing inner class method', () => {
      const result = getMethodLine(root, 'ns.MyClass.Inner.notFound()');
      expect(result.line).toBe(6);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('er.notFound()');
    });

    it('should ignore namespace and find correct class', () => {
      const result = getMethodLine(root, 'com.example.MyClass.bar(Integer)');
      expect(result.line).toBe(3);
      expect(result.isExactMatch).toBe(true);
    });

    it('should handle case-insensitive namespace', () => {
      const result = getMethodLine(root, 'MYNS.myclass.foo()');
      expect(result.line).toBe(2);
      expect(result.isExactMatch).toBe(true);
    });
  });

  describe('getMethodLine - inner class methods', () => {
    let root: ApexNode;

    beforeEach(() => {
      root = parseApex('');
    });

    it('should find inner class method bar with single integer param', () => {
      const result = getMethodLine(root, 'MyClass.Inner.bar(Integer)');
      expect(result.line).toBe(9);
      expect(result.isExactMatch).toBe(true);
    });

    it('should return inner class line when method with qualified type parameters not found', () => {
      const result = getMethodLine(
        root,
        'MyClass.Inner.bar(MyClass.InnerClass, InnerClass, Integer, Integer)',
      );
      expect(result.line).toBe(6);
      expect(result.isExactMatch).toBe(false);
    });

    it('should return inner class line when method not found in inner class', () => {
      const result = getMethodLine(root, 'MyClass.Inner.missingMethod()');
      expect(result.line).toBe(6);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('missingMethod()');
    });

    it('should return inner class line when constructor not found in inner class', () => {
      const result = getMethodLine(root, 'MyClass.Inner(Boolean)');
      expect(result.line).toBe(6);
      expect(result.isExactMatch).toBe(false);
      expect(result.missingSymbol).toBe('Inner(Boolean)');
    });

    it('should find inner class constructor with no parameters', () => {
      const result = getMethodLine(root, 'MyClass.Inner()');
      expect(result.line).toBe(7);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find inner class constructor with string parameter', () => {
      const result = getMethodLine(root, 'MyClass.Inner(String)');
      expect(result.line).toBe(8);
      expect(result.isExactMatch).toBe(true);
    });

    it('should return method line when inner class not found', () => {
      const result = getMethodLine(root, 'MyClass.NonExistent.foo()');
      expect(result.line).toBe(2);
      expect(result.isExactMatch).toBe(true);
    });
  });

  describe('getMethodLine - fallback to class line', () => {
    let root: ApexNode;

    beforeEach(() => {
      root = parseApex('');
    });

    it('should return outer class line when method not found', () => {
      const result = getMethodLine(root, 'MyClass.unknownMethod()');
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
    });

    it('should return outer class line when constructor not found', () => {
      const result = getMethodLine(root, 'MyClass(Double)');
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
    });

    it('should return inner class line when method not found in inner class', () => {
      const result = getMethodLine(root, 'MyClass.Inner.unknownMethod()');
      expect(result.line).toBe(6);
      expect(result.isExactMatch).toBe(false);
    });

    it('should return inner class line when constructor params do not match', () => {
      const result = getMethodLine(root, 'MyClass.Inner(Double)');
      expect(result.line).toBe(6);
      expect(result.isExactMatch).toBe(false);
    });

    it('should return outer class line with namespace when method not found', () => {
      const result = getMethodLine(root, 'ns1.ns2.MyClass.unknownMethod()');
      expect(result.line).toBe(1);
      expect(result.isExactMatch).toBe(false);
    });

    it('should return inner class line with namespace when inner method not found', () => {
      const result = getMethodLine(root, 'ns.MyClass.Inner.unknownMethod()');
      expect(result.line).toBe(6);
      expect(result.isExactMatch).toBe(false);
    });

    it('should return inner class line when no default constructor found', () => {
      const result = getMethodLine(root, 'MyClass.Inner2()');
      expect(result.line).toBe(14);
      expect(result.isExactMatch).toBe(false);
    });
  });

  describe('getMethodLine - inner class with multiple constructors', () => {
    let root: ApexNode;

    beforeEach(() => {
      root = parseApex('');
    });

    it('should find first inner class constructor (no params)', () => {
      const result = getMethodLine(root, 'MyClass.Inner()');
      expect(result.line).toBe(7);
      expect(result.isExactMatch).toBe(true);
    });

    it('should find second inner class constructor (string param)', () => {
      const result = getMethodLine(root, 'MyClass.Inner(String)');
      expect(result.line).toBe(8);
      expect(result.isExactMatch).toBe(true);
    });

    it('should handle case-insensitive inner class constructor lookup', () => {
      const result = getMethodLine(root, 'myclass.inner()');
      expect(result.line).toBe(7);
      expect(result.isExactMatch).toBe(true);
    });

    it('should handle case-insensitive inner class constructor parameter lookup', () => {
      const result = getMethodLine(root, 'MyClass.INNER(string)');
      expect(result.line).toBe(8);
      expect(result.isExactMatch).toBe(true);
    });
  });
});
