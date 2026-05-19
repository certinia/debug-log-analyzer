/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { soqlGroupHeader } from '../groupHeader.js';

describe('soqlGroupHeader', () => {
  it('returns null when value is missing or empty', () => {
    expect(soqlGroupHeader('', 3, [])).toBe('');
    expect(soqlGroupHeader(undefined, 3, [])).toBe('');
  });

  it('returns null for non-SOQL rows', () => {
    const data = [{ originalData: { type: 'METHOD_ENTRY' } }];
    expect(soqlGroupHeader('SomeMethod', 5, data)).toBe('');
  });

  it('formats SOQL when first row is SOQL_EXECUTE_BEGIN', () => {
    const data = [{ originalData: { type: 'SOQL_EXECUTE_BEGIN' } }];
    const html = soqlGroupHeader('SELECT Id FROM Account', 2, data);
    expect(html).toContain('soql-block');
    expect(html).toContain('<span class="soql-tok-keyword">SELECT</span>');
    expect(html).toContain('(2)');
  });

  it('formats SOSL when first row is SOSL_EXECUTE_BEGIN', () => {
    const data = [{ originalData: { type: 'SOSL_EXECUTE_BEGIN' } }];
    const html = soqlGroupHeader('FIND {acme} RETURNING Account', 1, data);
    expect(html).toContain('<span class="soql-tok-keyword">FIND</span>');
    expect(html).toContain('<span class="soql-tok-keyword">RETURNING</span>');
  });

  it('formats when first row has matching soql field (SOQLView path)', () => {
    const key = 'SELECT Id FROM Account';
    const data = [{ soql: key }];
    const html = soqlGroupHeader(key, 4, data);
    expect(html).toContain('soql-tok-keyword');
    expect(html).toContain('(4)');
  });

  it('escapes html in identifiers', () => {
    const data = [{ originalData: { type: 'SOQL_EXECUTE_BEGIN' } }];
    const html = soqlGroupHeader('SELECT a<b> FROM x', 1, data);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;');
  });
});
