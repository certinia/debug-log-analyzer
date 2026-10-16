/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { render } from 'lit';

import { soqlGroupCell } from '../groupHeader.js';

const shown = (key: string, rows: unknown[]): HTMLElement => {
  const host = document.createElement('div');
  render(soqlGroupCell({ key, rows }), host);
  return host;
};

const soqlRow = { originalData: { type: 'SOQL_EXECUTE_BEGIN' } };

describe('soqlGroupCell', () => {
  it('shows an empty key as it is, with its count', () => {
    expect(soqlGroupCell({ key: '', rows: [soqlRow] })).toBe(' (1)');
  });

  it('shows a key whose rows are no query as the key and its count', () => {
    const rows = [{ originalData: { type: 'METHOD_ENTRY' } }];
    expect(soqlGroupCell({ key: 'SomeMethod', rows })).toBe('SomeMethod (1)');
  });

  it('highlights SOQL when the first row is SOQL_EXECUTE_BEGIN', () => {
    const cell = shown('SELECT Id FROM Account', [soqlRow, soqlRow]);

    // Single-line, so the group-header cell ellipsizes instead of wrapping.
    const query = cell.querySelector('.soql-group-header__q.soql-block.soql-inline');
    expect(query?.querySelector('.soql-tok-keyword')?.textContent).toBe('SELECT');
    // The count is pinned in its own element, so it stays visible when the query truncates.
    expect(cell.querySelector('.soql-group-header__count')?.textContent).toBe('(2)');
  });

  it('highlights SOSL when the first row is SOSL_EXECUTE_BEGIN', () => {
    const cell = shown('FIND {acme} RETURNING Account', [
      { originalData: { type: 'SOSL_EXECUTE_BEGIN' } },
    ]);

    const keywords = [...cell.querySelectorAll('.soql-tok-keyword')].map((k) => k.textContent);
    expect(keywords).toEqual(expect.arrayContaining(['FIND', 'RETURNING']));
  });

  it('highlights a key the first row names as its soql (SOQLView rows)', () => {
    const key = 'SELECT Id FROM Account';
    const cell = shown(key, [{ soql: key }, { soql: key }, { soql: key }, { soql: key }]);

    expect(cell.querySelector('.soql-tok-keyword')).not.toBeNull();
    expect(cell.querySelector('.soql-group-header__count')?.textContent).toBe('(4)');
  });

  it('escapes html in identifiers', () => {
    const cell = shown('SELECT a<b> FROM x', [soqlRow]);

    expect(cell.querySelector('b')).toBeNull();
    expect(cell.textContent).toContain('a<b>');
  });
});
