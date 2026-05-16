/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Token, TokenKind } from './tokenize.js';

export const CLASS_BY_KIND: Record<TokenKind, string | null> = {
  keyword: 'soql-tok-keyword',
  function: 'soql-tok-function',
  string: 'soql-tok-string',
  number: 'soql-tok-number',
  bind: 'soql-tok-bind',
  punct: 'soql-tok-punct',
  ident: null,
  ws: null,
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

export function renderInline(tokens: Token[]): string {
  let out = '';
  for (const t of tokens) {
    const cls = CLASS_BY_KIND[t.kind];
    const escaped = escapeHtml(t.text);
    out += cls ? `<span class="${cls}">${escaped}</span>` : escaped;
  }
  return out;
}
