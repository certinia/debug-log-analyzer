/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  countLeaves,
  INDENT,
  isPunct,
  parseConditions,
  splitClauses,
  splitList,
  type Clause,
  type ConditionNode,
} from './clauses.js';
import { needsSpaceBefore } from './renderPretty.js';
import type { Token } from './tokenize.js';

/** The space a caller has for a query: how many lines, and how many characters each holds. */
export interface SoqlBudget {
  lines: number;
  columns: number;
}

/** Lines a clause gets before spare lines are shared out. */
const BASE_LINES: Record<string, number> = {
  SELECT: 1,
  FROM: 1,
  WHERE: 3,
  HAVING: 1,
  'GROUP BY': 1,
  'ORDER BY': 1,
  LIMIT: 1,
  OFFSET: 1,
};

const DEFAULT_LINES = 1;

/** An `IN` list of this many literals or more collapses to a count. */
const LITERAL_LIST_MIN = 5;

const OPEN: Token = { kind: 'punct', text: '(' };
const CLOSE: Token = { kind: 'punct', text: ')' };
const COMMA: Token = { kind: 'punct', text: ',' };

type Chunk = Token | string;

function elide(text: string): Token {
  return { kind: 'elision', text };
}

function width(chunks: Chunk[]): number {
  return chunks.reduce((n, c) => n + (typeof c === 'string' ? c.length : c.text.length), 0);
}

function lineCost(line: Chunk[], columns: number): number {
  return Math.max(1, Math.ceil(width(line) / Math.max(1, columns)));
}

/** Lay tokens out on one line, with the spacing the pretty printer uses. */
function toChunks(tokens: Token[]): Chunk[] {
  const out: Chunk[] = [];
  let prev: Token | undefined;
  for (const token of tokens) {
    if (prev && needsSpaceBefore(prev, token)) {
      out.push(' ');
    }
    out.push(token);
    prev = token;
  }
  return out;
}

/**
 * Render a query into a fixed number of lines: one line per clause section, each
 * section keeping what fits and saying how much it left out.
 *
 * Emits the same `(Token | string)` chunk stream as the pretty printer, so both
 * the HTML and the Lit renderer take it unchanged.
 */
export function budgetedChunks(tokens: Token[], budget: SoqlBudget): Chunk[] {
  // A short query reads better whole than split over a clause per line.
  const inline = toChunks(tokens.filter((t) => t.kind !== 'ws'));
  if (width(inline) <= budget.columns) {
    return inline;
  }

  const clauses = splitClauses(tokens);
  const allowances = allocate(clauses, budget.lines);
  const lines: Chunk[][] = [];
  let used = 0;

  for (const clause of clauses) {
    const spare = budget.lines - used;
    if (spare <= 0) {
      break;
    }
    const allowed = Math.min(allowances.get(clause) ?? DEFAULT_LINES, spare);
    const rendered = renderClause(clause, allowed, budget.columns);
    for (const line of rendered) {
      lines.push(line);
      used += lineCost(line, budget.columns);
    }
  }

  const out: Chunk[] = [];
  lines.forEach((line, i) => {
    if (i) {
      out.push('\n');
    }
    out.push(...line);
  });
  return out;
}

/** Give every clause its base allowance, then hand every spare line to `WHERE`. */
function allocate(clauses: Clause[], lines: number): Map<Clause, number> {
  const allowances = new Map<Clause, number>();
  let base = 0;
  for (const clause of clauses) {
    const allowance = BASE_LINES[clause.keyword] ?? DEFAULT_LINES;
    allowances.set(clause, allowance);
    base += allowance;
  }

  const spare = lines - base;
  const where = clauses.find((c) => c.keyword === 'WHERE' || c.keyword === 'HAVING');
  if (spare > 0 && where) {
    allowances.set(where, (allowances.get(where) ?? DEFAULT_LINES) + spare);
  }
  return allowances;
}

function renderClause(clause: Clause, allowed: number, columns: number): Chunk[][] {
  switch (clause.keyword) {
    case 'SELECT':
    case 'GROUP BY':
      return [renderList(clause, columns)];
    case 'WHERE':
    case 'HAVING':
      return renderConditions(clause, allowed, columns);
    default:
      return [toChunks([...clause.head, ...clause.body])];
  }
}

/** One line of comma-separated items, with `+N fields` for the rest. */
function renderList(clause: Clause, columns: number): Chunk[] {
  const items = splitList(clause.body).map((item) => toChunks(collapseSubquery(item)));
  const line: Chunk[] = toChunks(clause.head);
  let shown = 0;

  for (const item of items) {
    const separator: Chunk[] = shown ? [COMMA, ' '] : [' '];
    const rest = items.length - shown - 1;
    const tail = rest > 0 ? ` +${rest} fields`.length : 0;
    if (shown && width(line) + width(separator) + width(item) + tail > columns) {
      break;
    }
    line.push(...separator, ...item);
    shown++;
  }

  const hidden = items.length - shown;
  if (hidden > 0) {
    line.push(' ', elide(`+${hidden} fields`));
  }
  return line;
}

/**
 * A subquery in a field list keeps its shape but not its detail:
 * `(SELECT Id, Name FROM Contacts)` becomes `(SELECT … FROM Contacts)`.
 */
function collapseSubquery(item: Token[]): Token[] {
  const select = item[1];
  if (!isPunct(item[0], '(') || select?.text.toUpperCase() !== 'SELECT') {
    return item;
  }

  let depth = 0;
  for (let i = 1; i < item.length; i++) {
    const token = item[i]!;
    if (isPunct(token, '(')) {
      depth++;
    } else if (isPunct(token, ')')) {
      depth--;
    } else if (depth === 0 && token.text.toUpperCase() === 'FROM') {
      const object = item[i + 1];
      return object ? [OPEN, select, elide('…'), token, object, CLOSE] : item;
    }
  }
  return item;
}

/** One line per condition, continuation lines led by their `AND`/`OR`. */
function renderConditions(clause: Clause, allowed: number, columns: number): Chunk[][] {
  const { parts, joins } = parseConditions(clause.body);
  const lines: Chunk[][] = [];
  let used = 0;

  for (let i = 0; i < parts.length; i++) {
    const prefix: Chunk[] = i === 0 ? toChunks(clause.head) : [INDENT, joins[i - 1]!];
    const line: Chunk[] = [...prefix, ' ', ...renderCondition(parts[i]!, columns - width(prefix))];
    const cost = lineCost(line, columns);
    // Keep a line back for the count of the rest, unless this is the last condition.
    const reserve = i < parts.length - 1 ? 1 : 0;

    if (i > 0 && used + cost + reserve > allowed) {
      const hidden = parts.slice(i).reduce((n, part) => n + countLeaves(part), 0);
      lines.push([INDENT, elide(`… +${hidden} conditions`)]);
      break;
    }
    lines.push(line);
    used += cost;
  }

  return lines;
}

/**
 * Render one condition. A parenthesised group keeps the author's grouping: it
 * stays whole when it fits, else it keeps what fits and counts the rest.
 */
function renderCondition(node: ConditionNode, available: number): Chunk[] {
  if (node.kind === 'leaf') {
    return toChunks(collapseLiterals(node.tokens));
  }

  const out: Chunk[] = node.wrapped ? [OPEN] : [];
  let shown = 0;

  for (let i = 0; i < node.parts.length; i++) {
    const separator: Chunk[] = i ? [' ', node.joins[i - 1]!, ' '] : [];
    const part = renderCondition(node.parts[i]!, available);
    const rest = node.parts.slice(i + 1).reduce((n, p) => n + countLeaves(p), 0);
    const tail = rest > 0 ? ` … +${rest} conditions`.length : 0;
    if (i && width(out) + width(separator) + width(part) + tail > available) {
      break;
    }
    out.push(...separator, ...part);
    shown++;
  }

  const hidden = node.parts.slice(shown).reduce((n, part) => n + countLeaves(part), 0);
  if (hidden > 0) {
    out.push(' ', elide(`… +${hidden} conditions`));
  }
  if (node.wrapped) {
    out.push(CLOSE);
  }
  return out;
}

/** A long list of literals says how many it holds instead of listing them. */
function collapseLiterals(tokens: Token[]): Token[] {
  const open = tokens.findIndex((t) => isPunct(t, '('));
  if (open < 1) {
    return tokens;
  }

  let depth = 0;
  let close = -1;
  for (let i = open; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (isPunct(token, '(')) {
      depth++;
    } else if (isPunct(token, ')')) {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) {
    return tokens;
  }

  const items = splitList(tokens.slice(open + 1, close));
  const literals = items.filter((item) => item.length === 1 && isLiteral(item[0]!));
  if (literals.length < LITERAL_LIST_MIN || literals.length !== items.length) {
    return tokens;
  }

  const allIds = literals.every((item) => /^'[a-zA-Z0-9]{15,18}'$/.test(item[0]!.text));
  const label = allIds ? 'ids' : 'values';
  return [
    ...tokens.slice(0, open),
    OPEN,
    elide(`… ${items.length} ${label}`),
    CLOSE,
    ...tokens.slice(close + 1),
  ];
}

function isLiteral(token: Token): boolean {
  return token.kind === 'string' || token.kind === 'number';
}
