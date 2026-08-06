/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import { soqlInlineElement } from '../inlineCell.js';

describe('soqlInlineElement', () => {
  it('returns a highlighted single-line span for a SOQL query', () => {
    const el = soqlInlineElement('SELECT Id FROM Account', 'soql');
    expect(el.className).toBe('soql-block soql-inline');
    // Keywords carry their own token class, so the text is highlighted, not raw.
    expect(el.querySelectorAll('span').length).toBeGreaterThan(0);
    expect(el.textContent).toBe('SELECT Id FROM Account');
  });

  it('highlights SOSL with the sosl dialect', () => {
    const el = soqlInlineElement('FIND {Acme} IN ALL FIELDS RETURNING Account(Id)', 'sosl');
    expect(el.querySelectorAll('span').length).toBeGreaterThan(0);
    expect(el.textContent).toBe('FIND {Acme} IN ALL FIELDS RETURNING Account(Id)');
  });

  it('renders empty text as an empty span', () => {
    const el = soqlInlineElement('', 'soql');
    expect(el.className).toBe('soql-block soql-inline');
    expect(el.textContent).toBe('');
  });
});
