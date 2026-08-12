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
  elision: 'soql-tok-elision',
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

/** Render a chunk stream as classed spans. Strings are literal text: spaces, newlines, indents. */
export function chunksToHtml(chunks: (Token | string)[]): string {
  let out = '';
  for (const chunk of chunks) {
    if (typeof chunk === 'string') {
      out += chunk;
      continue;
    }
    const cls = CLASS_BY_KIND[chunk.kind];
    const escaped = escapeHtml(chunk.text);
    out += cls ? `<span class="${cls}">${escaped}</span>` : escaped;
  }
  return out;
}
