/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { parseSymbol, type ApexSymbol } from '../codesymbol/ApexSymbolParser';
import type { SfdxProject } from '../codesymbol/SfdxProjectReader';

function createProject(namespace: string): SfdxProject {
  return {
    name: 'test-project',
    namespace,
    packageDirectories: [{ path: 'force-app', default: true }],
  };
}

describe('parseSymbol', () => {
  describe('without namespace', () => {
    const projects: SfdxProject[] = [];

    it('should parse simple class and method', () => {
      const result = parseSymbol('MyClass.myMethod()', projects);

      expect(result).toEqual<ApexSymbol>({
        fullSymbol: 'MyClass.myMethod()',
        namespace: null,
        outerClass: 'MyClass',
        innerClass: null,
        method: 'myMethod',
        parameters: '',
      });
    });

    it('should parse method with parameters', () => {
      const result = parseSymbol('MyClass.myMethod(String, Integer)', projects);

      expect(result).toEqual<ApexSymbol>({
        fullSymbol: 'MyClass.myMethod(String, Integer)',
        namespace: null,
        outerClass: 'MyClass',
        innerClass: null,
        method: 'myMethod',
        parameters: 'String, Integer',
      });
    });

    it('should parse inner class method', () => {
      const result = parseSymbol('MyClass.Inner.myMethod()', projects);

      expect(result).toEqual<ApexSymbol>({
        fullSymbol: 'MyClass.Inner.myMethod()',
        namespace: null,
        outerClass: 'MyClass',
        innerClass: 'Inner',
        method: 'myMethod',
        parameters: '',
      });
    });

    it('should parse inner class method with parameters', () => {
      const result = parseSymbol('MyClass.Inner.myMethod(String)', projects);

      expect(result).toEqual<ApexSymbol>({
        fullSymbol: 'MyClass.Inner.myMethod(String)',
        namespace: null,
        outerClass: 'MyClass',
        innerClass: 'Inner',
        method: 'myMethod',
        parameters: 'String',
      });
    });
  });

  describe('with namespace', () => {
    const projects = [createProject('ns')];

    it('should parse namespaced class and method', () => {
      const result = parseSymbol('ns.MyClass.myMethod()', projects);

      expect(result).toEqual<ApexSymbol>({
        fullSymbol: 'ns.MyClass.myMethod()',
        namespace: 'ns',
        outerClass: 'MyClass',
        innerClass: null,
        method: 'myMethod',
        parameters: '',
      });
    });

    it('should parse namespaced method with parameters', () => {
      const result = parseSymbol('ns.MyClass.myMethod(String, Integer)', projects);

      expect(result).toEqual<ApexSymbol>({
        fullSymbol: 'ns.MyClass.myMethod(String, Integer)',
        namespace: 'ns',
        outerClass: 'MyClass',
        innerClass: null,
        method: 'myMethod',
        parameters: 'String, Integer',
      });
    });

    it('should parse namespaced inner class method', () => {
      const result = parseSymbol('ns.MyClass.Inner.myMethod()', projects);

      expect(result).toEqual<ApexSymbol>({
        fullSymbol: 'ns.MyClass.Inner.myMethod()',
        namespace: 'ns',
        outerClass: 'MyClass',
        innerClass: 'Inner',
        method: 'myMethod',
        parameters: '',
      });
    });

    it('should parse namespaced inner class method with parameters', () => {
      const result = parseSymbol('ns.MyClass.Inner.myMethod(String)', projects);

      expect(result).toEqual<ApexSymbol>({
        fullSymbol: 'ns.MyClass.Inner.myMethod(String)',
        namespace: 'ns',
        outerClass: 'MyClass',
        innerClass: 'Inner',
        method: 'myMethod',
        parameters: 'String',
      });
    });
  });

  describe('namespace detection', () => {
    it('should detect namespace from projects when symbol has 3 parts', () => {
      const projects = [createProject('myns')];
      const result = parseSymbol('myns.MyClass.myMethod()', projects);

      expect(result.namespace).toBe('myns');
      expect(result.outerClass).toBe('MyClass');
    });

    it('should not detect namespace when first part does not match any project', () => {
      const projects = [createProject('otherns')];
      const result = parseSymbol('MyClass.Inner.myMethod()', projects);

      expect(result.namespace).toBeNull();
      expect(result.outerClass).toBe('MyClass');
      expect(result.innerClass).toBe('Inner');
    });

    it('should always detect namespace when symbol has 4 parts', () => {
      const projects: SfdxProject[] = [];
      const result = parseSymbol('ns.MyClass.Inner.myMethod()', projects);

      expect(result.namespace).toBe('ns');
      expect(result.outerClass).toBe('MyClass');
      expect(result.innerClass).toBe('Inner');
    });
  });

  describe('error handling', () => {
    it('should throw error for empty symbol', () => {
      expect(() => parseSymbol('', [])).toThrow('Invalid symbol: ');
    });
  });
});
