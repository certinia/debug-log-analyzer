/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Token } from './tokenize.js';

/** Keywords that open a clause. `GROUP` and `ORDER` take the following `BY`. */
export const CLAUSE_KEYWORDS = new Set<string>([
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

/** Keywords that join two conditions. */
export const COND_JOIN = new Set<string>(['AND', 'OR']);

/** One level of indent, shared by every layout. */
export const INDENT = '  ';

/** One clause of a query: its keyword tokens, and every token up to the next clause. */
export interface Clause {
  /** Upper-case name, `GROUP BY` and `ORDER BY` included. Empty for text before any clause. */
  keyword: string;
  head: Token[];
  body: Token[];
}

/**
 * A boolean expression. A `leaf` is one comparison; a `group` is a run of nodes
 * joined by `AND`/`OR`, either the clause itself or a parenthesised sub-expression.
 */
export interface ConditionGroup {
  kind: 'group';
  parts: ConditionNode[];
  joins: Token[];
  wrapped: boolean;
}

export type ConditionNode = { kind: 'leaf'; tokens: Token[] } | ConditionGroup;

export function isPunct(token: Token | undefined, text: string): boolean {
  return !!token && token.kind === 'punct' && token.text === text;
}

/**
 * Split a token stream into clauses. Only depth 0 counts, so a subquery's own
 * `SELECT`/`FROM` stay inside the body of the clause that holds it.
 */
export function splitClauses(tokens: Token[]): Clause[] {
  const nonWs = tokens.filter((t) => t.kind !== 'ws');
  const clauses: Clause[] = [];
  let current: Clause | undefined;
  let depth = 0;

  for (let i = 0; i < nonWs.length; i++) {
    const token = nonWs[i]!;
    if (isPunct(token, '(')) {
      depth++;
    } else if (isPunct(token, ')')) {
      depth = Math.max(0, depth - 1);
    }

    const upper = token.text.toUpperCase();
    const opensClause =
      depth === 0 &&
      (token.kind === 'keyword' || token.kind === 'function') &&
      CLAUSE_KEYWORDS.has(upper);

    if (opensClause) {
      const head = [token];
      let keyword = upper;
      const next = nonWs[i + 1];
      if ((upper === 'GROUP' || upper === 'ORDER') && next?.text.toUpperCase() === 'BY') {
        head.push(next);
        keyword = `${upper} BY`;
        i++;
      }
      current = { keyword, head, body: [] };
      clauses.push(current);
      continue;
    }

    if (!current) {
      current = { keyword: '', head: [], body: [] };
      clauses.push(current);
    }
    current.body.push(token);
  }

  return clauses;
}

/**
 * Parse a `WHERE`/`HAVING` body into leaves and groups.
 *
 * `AND`/`OR` separate at every nesting level, so the leaf count is the number of
 * comparisons rather than the number of top-level terms. `NOT` stays with the
 * operand it modifies and is never a leaf of its own.
 */
export function parseConditions(tokens: Token[]): ConditionGroup {
  const parts: ConditionNode[] = [];
  const joins: Token[] = [];
  let buffer: Token[] = [];
  let depth = 0;

  const flush = (): void => {
    if (buffer.length) {
      parts.push(toNode(buffer));
      buffer = [];
    }
  };

  for (const token of tokens) {
    if (isPunct(token, '(')) {
      depth++;
    } else if (isPunct(token, ')')) {
      depth--;
    }

    const upper = token.text.toUpperCase();
    const isJoin =
      depth === 0 && (token.kind === 'keyword' || token.kind === 'ident') && COND_JOIN.has(upper);
    if (isJoin) {
      flush();
      joins.push(token);
      continue;
    }
    buffer.push(token);
  }
  flush();

  return { kind: 'group', parts, joins, wrapped: false };
}

/** A part wrapped in its own parentheses is a group; anything else is one comparison. */
function toNode(tokens: Token[]): ConditionNode {
  if (!isWrapped(tokens)) {
    return { kind: 'leaf', tokens };
  }
  const inner = parseConditions(tokens.slice(1, -1));
  return inner.parts.length > 1 ? { ...inner, wrapped: true } : { kind: 'leaf' as const, tokens };
}

/** True when the first token is `(` and its match is the last token. */
function isWrapped(tokens: Token[]): boolean {
  const last = tokens[tokens.length - 1];
  if (!isPunct(tokens[0], '(') || !isPunct(last, ')')) {
    return false;
  }
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (isPunct(token, '(')) {
      depth++;
    } else if (isPunct(token, ')')) {
      depth--;
      if (depth === 0) {
        return i === tokens.length - 1;
      }
    }
  }
  return false;
}

/** The number of comparisons under a node, at every nesting level. */
export function countLeaves(node: ConditionNode): number {
  return node.kind === 'leaf' ? 1 : node.parts.reduce((sum, part) => sum + countLeaves(part), 0);
}

/** Split a clause body on its top-level commas — a field list, or an order list. */
export function splitList(tokens: Token[]): Token[][] {
  const items: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;

  for (const token of tokens) {
    if (isPunct(token, '(')) {
      depth++;
    } else if (isPunct(token, ')')) {
      depth--;
    } else if (depth === 0 && isPunct(token, ',')) {
      items.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length) {
    items.push(current);
  }

  return items;
}
