/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { formatSOQL } from './formatter.js';
import type { Dialect } from './tokenize.js';

/**
 * A single-line highlighted query for a Tabulator cell. The `soql-block` /
 * `soql-inline` classes come from `soql-syntax.css.ts`, which the host component
 * must have in its `static styles`.
 */
export function soqlInlineElement(text: string, dialect: Dialect): HTMLElement {
  const span = document.createElement('span');
  span.className = 'soql-block soql-inline';
  span.innerHTML = formatSOQL(text, { mode: 'inline', dialect });
  return span;
}
