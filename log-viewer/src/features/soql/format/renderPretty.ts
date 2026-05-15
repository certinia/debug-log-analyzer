/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { escapeHtml } from './renderInline.js';
import type { Token, TokenKind } from './tokenize.js';

const CLASS_BY_KIND: Record<TokenKind, string | null> = {
  keyword: 'soql-tok-keyword',
  function: 'soql-tok-function',
  string: 'soql-tok-string',
  number: 'soql-tok-number',
  bind: 'soql-tok-bind',
  punct: 'soql-tok-punct',
  ident: null,
  ws: null,
};

const MAJOR_CLAUSE = new Set<string>([
  'SELECT',
  'FROM',
  'WHERE',
  'WITH',
  'GROUP',
  'HAVING',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'FOR',
  'FIND',
  'RETURNING',
  'USING',
  'TYPEOF',
]);

const COND_JOIN = new Set<string>(['AND', 'OR']);

const INDENT = '  ';

function renderToken(t: Token): string {
  const cls = CLASS_BY_KIND[t.kind];
  const escaped = escapeHtml(t.text);
  return cls ? `<span class="${cls}">${escaped}</span>` : escaped;
}

function isKeyword(t: Token | undefined, name: string): boolean {
  return !!t && (t.kind === 'keyword' || t.kind === 'function') && t.text.toUpperCase() === name;
}

function isPunct(t: Token | undefined, ch: string): boolean {
  return !!t && t.kind === 'punct' && t.text === ch;
}

export function renderPretty(tokens: Token[]): string {
  const nonWs = tokens.filter((t) => t.kind !== 'ws');
  let out = '';
  let depth = 0;
  // depths at which '(' opened a subquery (so ')' needs a leading newline)
  const subqueryDepths = new Set<number>();
  let prev: Token | undefined;
  let atLineStart = true;
  // whether the most recent major clause at each depth is WHERE/HAVING (for AND/OR breaks)
  const condClauseStack: boolean[] = [];

  const write = (s: string) => {
    out += s;
    if (s.length > 0) {
      atLineStart = s.endsWith('\n');
    }
  };

  const newline = (level: number) => {
    out += '\n' + INDENT.repeat(level);
    atLineStart = true;
  };

  for (let i = 0; i < nonWs.length; i++) {
    const t = nonWs[i]!;
    const next = nonWs[i + 1];

    // closing paren - if subquery, break before
    if (t.kind === 'punct' && t.text === ')') {
      if (subqueryDepths.has(depth)) {
        subqueryDepths.delete(depth);
        newline(depth - 1);
      }
      depth = Math.max(0, depth - 1);
      condClauseStack.length = Math.min(condClauseStack.length, depth + 1);
      write(renderToken(t));
      prev = t;
      continue;
    }

    // major clause start
    const upper = t.text.toUpperCase();
    const isMajor = (t.kind === 'keyword' || t.kind === 'function') && MAJOR_CLAUSE.has(upper);
    if (isMajor) {
      if (!atLineStart && out.length > 0) {
        newline(depth);
      }
      write(renderToken(t));
      condClauseStack[depth] = upper === 'WHERE' || upper === 'HAVING';
      prev = t;
      continue;
    }

    // AND/OR inside WHERE/HAVING at current depth
    if (
      (t.kind === 'keyword' || t.kind === 'ident') &&
      COND_JOIN.has(upper) &&
      condClauseStack[depth]
    ) {
      newline(depth + 1);
      write(renderToken(t));
      prev = t;
      continue;
    }

    // opening paren
    if (t.kind === 'punct' && t.text === '(') {
      // separator before '('
      if (needsSpaceBefore(prev, t)) {
        write(' ');
      }
      write(renderToken(t));
      depth++;
      // detect subquery: next non-ws is SELECT / FIND
      if (isKeyword(next, 'SELECT') || isKeyword(next, 'FIND')) {
        subqueryDepths.add(depth);
        newline(depth);
      }
      prev = t;
      continue;
    }

    // default token
    if (!atLineStart && needsSpaceBefore(prev, t)) {
      write(' ');
    }
    write(renderToken(t));
    prev = t;
  }

  return out;
}

function needsSpaceBefore(prev: Token | undefined, cur: Token): boolean {
  if (!prev) {
    return false;
  }
  if (isPunct(prev, '(')) {
    return false;
  }
  if (isPunct(prev, '.')) {
    return false;
  }
  if (isPunct(cur, ')')) {
    return false;
  }
  if (isPunct(cur, ',')) {
    return false;
  }
  if (isPunct(cur, '.')) {
    return false;
  }
  // function-call open paren attaches to identifier/function
  if (isPunct(cur, '(') && prev.kind === 'function') {
    return false;
  }
  if (isPunct(cur, '(') && prev.kind === 'ident') {
    return false;
  }
  return true;
}
