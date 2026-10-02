/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { getMethodLine, parseApex } from '../ApexParser/ApexSymbolLocator';

jest.mock('../ApexParser/ApexVisitor', () => ({
  ApexVisitor: class {
    visit() {
      return mockAST;
    }
  },
}));
jest.mock('@apexdevtools/apex-parser', () => ({
  ApexParserFactory: {
    createParser: jest.fn(() => ({ compilationUnit: jest.fn() })),
  },
  ApexParserBaseVisitor: class {},
}));

const mockAST = {
  children: [
    {
      nature: 'Class',
      name: 'myclass',
      line: 1,
      children: [
        { nature: 'Method', name: 'foo', params: '', line: 2 },
        { nature: 'Method', name: 'bar', params: 'integer', line: 3 },
        { nature: 'Method', name: 'bar', params: 'integer,integer', line: 4 },
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
            { nature: 'Constructor', name: 'Inner', params: '', line: 7 },
            { nature: 'Constructor', name: 'Inner', params: 'String', line: 8 },
            { nature: 'Method', name: 'bar', params: 'integer', line: 9 },
          ],
        },
        { nature: 'Constructor', name: 'MyClass', params: '', line: 10 },
        { nature: 'Constructor', name: 'MyClass', params: 'string', line: 11 },
        { nature: 'Constructor', name: 'MyClass', params: 'string,integer', line: 12 },
        {
          nature: 'Constructor',
          name: 'MyClass',
          params: 'Map<Id, MyClass.InnerClass>, Map<Id, InnerClass>, String, Integer',
          line: 13,
        },
        { nature: 'Class', name: 'inner2', line: 14, children: [] },
      ],
    },
  ],
};

describe('getMethodLine', () => {
  const root = parseApex('');

  it.each([
    ['MyClass.foo()', 2],
    ['MyClass.bar(Integer)', 3],
    ['MyClass.bar(Integer, Integer)', 4],
    ['MyClass.bar(System.Integer)', 3],
    ['myns.MyClass.bar(myns.Integer)', 3],
    // only the source declaration qualifies the param type
    ['MyClass.bar(InnerClass, InnerClass, Integer, Integer)', 5],
    ['MyClass.Inner.bar(Integer)', 9],
    // an unknown middle segment falls through to the outer class's method
    ['MyClass.NonExistent.foo()', 2],
    ['MyClass()', 10],
    ['MyClass(String)', 11],
    ['MyClass(String, Integer)', 12],
    ['MyClass(Map<Id, MyClass.InnerClass>, Map<Id, InnerClass>, String, Integer)', 13],
    // within MyClass, `InnerClass` and `MyClass.InnerClass` are the same type
    ['MyClass(Map<Id, InnerClass>, Map<Id, MyClass.InnerClass>, String, Integer)', 13],
    ['MyClass(System.String)', 11],
    ['MyClass.Inner()', 7],
    ['MyClass.Inner(String)', 8],
    ['myclass()', 10],
    ['MyClass(string)', 11],
    ['myclass.inner()', 7],
    ['MyClass.INNER(string)', 8],
    ['myns.MyClass.foo()', 2],
    ['myns.MyClass()', 10],
    ['myns.MyClass.Inner.bar(Integer)', 9],
    ['myns.MyClass(String, Integer)', 12],
    ['ns.MyClass.bar(Integer, Integer)', 4],
    ['com.example.MyClass.bar(Integer)', 3],
    ['MYNS.myclass.foo()', 2],
    // with a namespace the bare `MyClass.` qualifier in the source must still strip
    ['myns.MyClass.bar(myns.MyClass.InnerClass, InnerClass, Integer, Integer)', 5],
  ])('finds %s on line %i', (symbol, line) => {
    expect(getMethodLine(root, symbol)).toMatchObject({ line, isExactMatch: true });
  });

  it.each([
    ['MyClass.notFound()', 1, 'notFound()'],
    ['NotAClass.foo()', 1, 'foo()'],
    ['MyClass(Boolean)', 1, 'MyClass(Boolean)'],
    ['MyClass.Inner.notFound()', 6, 'notFound()'],
    ['MyClass.Inner(Boolean)', 6, 'Inner(Boolean)'],
    // the source qualifies these params differently, so no overload matches
    [
      'MyClass.Inner.bar(MyClass.InnerClass, InnerClass, Integer, Integer)',
      6,
      'bar(MyClass.InnerClass, InnerClass, Integer, Integer)',
    ],
    // an inner class with no declared constructor
    ['MyClass.Inner2()', 14, 'Inner2()'],
    ['myns.MyClass.missing()', 1, 'missing()'],
    ['ns1.ns2.MyClass.unknownMethod()', 1, 'unknownMethod()'],
    ['ns.MyClass.Inner.notFound()', 6, 'notFound()'],
  ])('falls back from %s to line %i, naming %s', (symbol, line, missingSymbol) => {
    expect(getMethodLine(root, symbol)).toMatchObject({
      line,
      isExactMatch: false,
      missingSymbol,
    });
  });

  it('returns a non-match for a symbol with no parentheses', () => {
    expect(getMethodLine(root, 'MyClass')).toEqual({ line: 1, character: 0, isExactMatch: false });
  });
});
