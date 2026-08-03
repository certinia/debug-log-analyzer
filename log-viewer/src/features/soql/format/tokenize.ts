/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

export type TokenKind =
  'keyword' | 'function' | 'string' | 'number' | 'bind' | 'punct' | 'ident' | 'ws';

export interface Token {
  kind: TokenKind;
  text: string;
}

const SOQL_KEYWORDS = new Set<string>([
  'SELECT',
  'FROM',
  'WHERE',
  'WITH',
  'GROUP',
  'BY',
  'HAVING',
  'ORDER',
  'ASC',
  'DESC',
  'NULLS',
  'FIRST',
  'LAST',
  'LIMIT',
  'OFFSET',
  'FOR',
  'VIEW',
  'REFERENCE',
  'UPDATE',
  'TRACKING',
  'TYPEOF',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'USING',
  'SCOPE',
  'FIELDS',
  'STANDARD',
  'CUSTOM',
  'ALL',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'INCLUDES',
  'EXCLUDES',
  'NULL',
  'TRUE',
  'FALSE',
  'DATA',
  'CATEGORY',
  'AT',
  'ABOVE',
  'BELOW',
  'ABOVE_OR_BELOW',
  'SECURITY_ENFORCED',
  'USER_MODE',
  'SYSTEM_MODE',
  // date literal labels - treat as keywords for highlighting
  'YESTERDAY',
  'TODAY',
  'TOMORROW',
  'LAST_WEEK',
  'THIS_WEEK',
  'NEXT_WEEK',
  'LAST_MONTH',
  'THIS_MONTH',
  'NEXT_MONTH',
  'LAST_90_DAYS',
  'NEXT_90_DAYS',
  'LAST_N_DAYS',
  'NEXT_N_DAYS',
  'THIS_QUARTER',
  'LAST_QUARTER',
  'NEXT_QUARTER',
  'THIS_YEAR',
  'LAST_YEAR',
  'NEXT_YEAR',
  'THIS_FISCAL_QUARTER',
  'LAST_FISCAL_QUARTER',
  'NEXT_FISCAL_QUARTER',
  'THIS_FISCAL_YEAR',
  'LAST_FISCAL_YEAR',
  'NEXT_FISCAL_YEAR',
  'LAST_N_WEEKS',
  'NEXT_N_WEEKS',
  'LAST_N_MONTHS',
  'NEXT_N_MONTHS',
  'LAST_N_QUARTERS',
  'NEXT_N_QUARTERS',
  'LAST_N_YEARS',
  'NEXT_N_YEARS',
  'LAST_N_FISCAL_QUARTERS',
  'NEXT_N_FISCAL_QUARTERS',
  'LAST_N_FISCAL_YEARS',
  'NEXT_N_FISCAL_YEARS',
  'N_DAYS_AGO',
  'N_WEEKS_AGO',
  'N_MONTHS_AGO',
  'N_QUARTERS_AGO',
  'N_YEARS_AGO',
  'N_FISCAL_QUARTERS_AGO',
  'N_FISCAL_YEARS_AGO',
]);

const SOSL_KEYWORDS = new Set<string>([
  'FIND',
  'IN',
  'RETURNING',
  'USING',
  'LISTVIEW',
  'SNIPPET',
  'HIGHLIGHT',
  'CONVERSATION',
  'PHONE',
  'EMAIL',
  'NAME',
  'SIDEBAR',
  'DIVISION',
  'NETWORK',
  'METADATA',
  'WHERE',
  'WITH',
  'ORDER',
  'BY',
  'LIMIT',
  'OFFSET',
  'AND',
  'OR',
  'NOT',
  'DATA',
  'CATEGORY',
  'FIELDS',
  'ALL',
  'TRUE',
  'FALSE',
  'NULL',
]);

const FUNCTIONS = new Set<string>([
  'COUNT',
  'COUNT_DISTINCT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'GROUPING',
  'FORMAT',
  'TOLABEL',
  'CONVERTCURRENCY',
  'DISTANCE',
  'GEOLOCATION',
  'CALENDAR_YEAR',
  'CALENDAR_MONTH',
  'CALENDAR_QUARTER',
  'DAY_IN_MONTH',
  'DAY_IN_WEEK',
  'DAY_IN_YEAR',
  'DAY_ONLY',
  'FISCAL_YEAR',
  'FISCAL_MONTH',
  'FISCAL_QUARTER',
  'HOUR_IN_DAY',
  'WEEK_IN_MONTH',
  'WEEK_IN_YEAR',
  'CUBE',
  'ROLLUP',
]);

export type Dialect = 'soql' | 'sosl';

const PUNCT_CHARS = new Set<string>([
  '(',
  ')',
  ',',
  '.',
  ';',
  '=',
  '<',
  '>',
  '!',
  '+',
  '-',
  '*',
  '/',
  '|',
  '&',
  '%',
]);

function isIdentStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentCont(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

export function tokenize(input: string, dialect: Dialect = 'soql'): Token[] {
  const tokens: Token[] = [];
  const keywords = dialect === 'sosl' ? SOSL_KEYWORDS : SOQL_KEYWORDS;
  const len = input.length;
  let i = 0;

  while (i < len) {
    const ch = input[i]!;

    // whitespace run
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      const start = i;
      while (i < len) {
        const c = input[i]!;
        if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
          break;
        }
        i++;
      }
      tokens.push({ kind: 'ws', text: input.slice(start, i) });
      continue;
    }

    // quoted string '...' with \' and \\ escapes
    if (ch === "'") {
      const start = i;
      i++;
      while (i < len) {
        const c = input[i]!;
        if (c === '\\' && i + 1 < len) {
          i += 2;
          continue;
        }
        if (c === "'") {
          i++;
          break;
        }
        i++;
      }
      tokens.push({ kind: 'string', text: input.slice(start, i) });
      continue;
    }

    // SOSL search term {...} - treat as string
    if (ch === '{') {
      const start = i;
      i++;
      while (i < len && input[i] !== '}') {
        i++;
      }
      if (i < len) {
        i++;
      }
      tokens.push({ kind: 'string', text: input.slice(start, i) });
      continue;
    }

    // bind variable :foo or :foo.bar
    if (ch === ':') {
      const start = i;
      i++;
      while (i < len && (isIdentCont(input[i]!) || input[i] === '.')) {
        i++;
      }
      tokens.push({ kind: 'bind', text: input.slice(start, i) });
      continue;
    }

    // number
    if (isDigit(ch) || (ch === '-' && i + 1 < len && isDigit(input[i + 1]!))) {
      const start = i;
      if (ch === '-') {
        i++;
      }
      while (i < len && (isDigit(input[i]!) || input[i] === '.')) {
        i++;
      }
      tokens.push({ kind: 'number', text: input.slice(start, i) });
      continue;
    }

    // identifier / keyword
    if (isIdentStart(ch)) {
      const start = i;
      i++;
      while (i < len && isIdentCont(input[i]!)) {
        i++;
      }
      const text = input.slice(start, i);
      const upper = text.toUpperCase();
      let kind: TokenKind = 'ident';
      if (FUNCTIONS.has(upper)) {
        kind = 'function';
      } else if (keywords.has(upper)) {
        kind = 'keyword';
      }
      tokens.push({ kind, text });
      continue;
    }

    // multi-char punct: != <= >= <>
    if (i + 1 < len) {
      const two = input.slice(i, i + 2);
      if (two === '!=' || two === '<=' || two === '>=' || two === '<>') {
        tokens.push({ kind: 'punct', text: two });
        i += 2;
        continue;
      }
    }

    if (PUNCT_CHARS.has(ch)) {
      tokens.push({ kind: 'punct', text: ch });
      i++;
      continue;
    }

    // fallback - emit as ident so we still escape it
    tokens.push({ kind: 'ident', text: ch });
    i++;
  }

  return tokens;
}

export function detectDialect(input: string): Dialect {
  const m = input.match(/^\s*([A-Za-z_]+)/);
  if (m && m[1] && m[1].toUpperCase() === 'FIND') {
    return 'sosl';
  }
  return 'soql';
}
