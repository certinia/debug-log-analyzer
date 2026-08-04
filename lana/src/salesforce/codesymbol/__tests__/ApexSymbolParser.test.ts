/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { parseSymbolCandidates } from '../ApexSymbolParser';

describe('parseSymbolCandidates', () => {
  describe('symbols without a namespace', () => {
    it('should resolve a simple method symbol to its outer class', () => {
      const candidates = parseSymbolCandidates('MyClass.myMethod()', []);

      expect(candidates[0]).toEqual({
        fullSymbol: 'MyClass.myMethod()',
        namespace: null,
        outerClass: 'MyClass',
      });
    });

    it('should resolve an inner class method to the outer class first', () => {
      const candidates = parseSymbolCandidates('MyClass.Inner.myMethod()', []);

      expect(candidates).toEqual([
        { fullSymbol: 'MyClass.Inner.myMethod()', namespace: null, outerClass: 'MyClass' },
        { fullSymbol: 'MyClass.Inner.myMethod()', namespace: null, outerClass: 'Inner' },
      ]);
    });

    it('should resolve a constructor symbol', () => {
      const candidates = parseSymbolCandidates('MyClass(String)', []);

      expect(candidates).toEqual([
        { fullSymbol: 'MyClass(String)', namespace: null, outerClass: 'MyClass' },
      ]);
    });

    it('should return a candidate for a single-part symbol instead of throwing', () => {
      const candidates = parseSymbolCandidates('execute_anonymous_apex', []);

      expect(candidates).toEqual([
        {
          fullSymbol: 'execute_anonymous_apex',
          namespace: null,
          outerClass: 'execute_anonymous_apex',
        },
      ]);
    });
  });

  describe('symbols with a known project namespace', () => {
    const projects = [{ namespace: 'ns' }];

    it('should rank the namespaced candidate first', () => {
      const candidates = parseSymbolCandidates('ns.MyClass.myMethod()', projects);

      expect(candidates[0]).toEqual({
        fullSymbol: 'ns.MyClass.myMethod()',
        namespace: 'ns',
        outerClass: 'MyClass',
      });
      // the symbol could also be outer.inner.method with no namespace
      expect(candidates).toContainEqual(
        expect.objectContaining({ namespace: null, outerClass: 'ns' }),
      );
    });

    it('should strip constructor parameters from a namespaced constructor symbol', () => {
      const candidates = parseSymbolCandidates('ns.MyClass(String)', projects);

      expect(candidates[0]).toEqual({
        fullSymbol: 'ns.MyClass(String)',
        namespace: 'ns',
        outerClass: 'MyClass',
      });
    });

    it('should handle a fully qualified inner class method', () => {
      const candidates = parseSymbolCandidates('ns.Outer.Inner.myMethod()', projects);

      expect(candidates).toEqual([
        { fullSymbol: 'ns.Outer.Inner.myMethod()', namespace: 'ns', outerClass: 'Outer' },
        { fullSymbol: 'ns.Outer.Inner.myMethod()', namespace: null, outerClass: 'Outer' },
      ]);
    });
  });

  describe('symbols with an undeclared namespace', () => {
    it('should fall back to treating the first part as a namespace', () => {
      const candidates = parseSymbolCandidates('pkg.MyClass.myMethod()', []);

      expect(candidates).toEqual([
        { fullSymbol: 'pkg.MyClass.myMethod()', namespace: null, outerClass: 'pkg' },
        { fullSymbol: 'pkg.MyClass.myMethod()', namespace: null, outerClass: 'MyClass' },
      ]);
    });

    it('should skip the no-namespace candidate for four-part symbols', () => {
      // Apex nests one level, so 4 parts must start with a namespace
      const candidates = parseSymbolCandidates('pkg.Outer.Inner.myMethod()', []);

      expect(candidates).toEqual([
        { fullSymbol: 'pkg.Outer.Inner.myMethod()', namespace: null, outerClass: 'Outer' },
      ]);
    });
  });

  describe('parameter handling', () => {
    it('should ignore dot-qualified parameters when splitting the class path', () => {
      const candidates = parseSymbolCandidates(
        'MyClass.myMethod(System.String, ns.Outer.Inner)',
        [],
      );

      expect(candidates[0]).toEqual(
        expect.objectContaining({ namespace: null, outerClass: 'MyClass' }),
      );
      expect(
        candidates.every((c) => !c.outerClass.includes('(') && !c.outerClass.includes(')')),
      ).toBe(true);
    });
  });

  describe('malformed input', () => {
    it.each(['', '   ', '...', '()', '.method()'])('should not throw for %p', (symbol) => {
      expect(() => parseSymbolCandidates(symbol, [])).not.toThrow();
    });

    it('should return no candidates for an empty symbol', () => {
      expect(parseSymbolCandidates('', [])).toEqual([]);
      expect(parseSymbolCandidates('()', [])).toEqual([]);
    });

    it('should not emit duplicate candidates', () => {
      const candidates = parseSymbolCandidates('MyClass.MyClass()', []);

      const keys = candidates.map((c) => `${c.namespace}|${c.outerClass}`);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});
