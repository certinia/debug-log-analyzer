/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { SOQLExecuteBeginLine } from 'apex-log-parser';

/**
 * Derives the queried SObject name for the Database SOQL view. (An earlier
 * revision also classified whether the object counts toward the SOQL limit —
 * dropped because it's a 1:1 function of the object name, so the name alone
 * carries the signal, e.g. the `__mdt` suffix.)
 */

/**
 * The outermost `FROM` object of a SOQL string, best-effort. Parenthesised
 * groups (inner SELECTs, function args) are stripped first so a subquery's
 * `FROM` can't be mistaken for the main object. Returns `null` when no `FROM`
 * is found.
 */
export function parseFromObject(soql: string | undefined): string | null {
  if (!soql) {
    return null;
  }
  // Collapse nested parentheses from the inside out until none remain.
  let stripped = soql;
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(/\([^()]*\)/g, ' ');
  } while (stripped !== previous);

  const match = /\bFROM\s+([A-Za-z0-9_]+)/i.exec(stripped);
  return match?.[1] ?? null;
}

/**
 * The queried SObject name for a SOQL line. Prefers the query-plan `sObjectType`
 * (accurate, present only at Database=FINEST); otherwise falls back to a
 * best-effort parse of the query text's `FROM` clause.
 */
export function deriveSoqlObject(soql: SOQLExecuteBeginLine): string | null {
  return soql.children[0]?.sObjectType ?? parseFromObject(soql.text);
}
