/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from 'apex-log-parser';

import { limitTotals } from '../../../components/logOverviewMetrics.js';
import { apexLimitTimeSeries } from '../../timeline/optimised/apex-limit-series.js';
import { SOSL_ROWS_PER_QUERY_LIMIT } from '../limits.js';
import {
  databaseOverview,
  UNKNOWN_OBJECT,
  type DatabaseStatement,
  type StatementKind,
} from './databaseOverview.js';

/** The kinds that hold rows against a transaction total. A search holds none. */
export type RowBudgetKind = Extract<StatementKind, 'SOQL' | 'DML'>;

/** The rows one SObject holds, across every statement that touched it. */
export interface RowGroup {
  sObject: string;
  rows: number;
  /** Times a statement read or wrote it, so the tip says what the rows are made of. */
  statements: number;
}

/** One row limit, what the log holds against it, and what holds it. */
export interface RowBudget {
  kind: RowBudgetKind;
  /** The governor's peak level, or `null` when the log captured no snapshot. */
  used: number | null;
  /** Rows summed from the statements themselves — what the SObject split adds up to. */
  observed: number;
  limit: number;
  /** Biggest SObject first. */
  groups: RowGroup[];
}

/** One SObject's rows, read beside written, across every statement that touched it. */
export interface ObjectRows {
  sObject: string;
  rowsRead: number;
  rowsWritten: number;
  /** The two sides summed: the length the segment is drawn at. */
  rows: number;
}

/** A statement count against its own limit, for the counts line. */
export interface RowCount {
  label: string;
  used: number;
  limit: number;
}

/** Everything the Row budget section reads. */
export interface RowBudgets {
  budgets: RowBudget[];
  /** Every SObject once, read beside written, biggest first. Empty unless both limits hold rows. */
  objects: ObjectRows[];
  counts: RowCount[];
  /** The most rows one SOSL query returned, against its per-query cap. */
  worstSearch: { rows: number; limit: number } | null;
  /** False when the log holds no `CUMULATIVE_LIMIT_USAGE`, so every figure is observed. */
  hasLimits: boolean;
  statements: number;
}

const cache = new WeakMap<ApexLog, RowBudgets>();

/**
 * The log's rows against the two row limits, split by the SObject that holds
 * them, plus the statement counts and the worst single search.
 *
 * The governor's peak is authoritative, so it is the figure shown; rows the
 * statements do not account for are reported rather than scaled away. Without a
 * cumulative snapshot there is no peak, so the observed rows answer.
 */
export function rowBudgets(log: ApexLog): RowBudgets {
  const cached = cache.get(log);
  if (cached) {
    return cached;
  }
  const budgets = build(log);
  cache.set(log, budgets);
  return budgets;
}

function build(log: ApexLog): RowBudgets {
  const overview = databaseOverview(log);
  const limits = limitTotals(apexLimitTimeSeries(log));
  const hasLimits = log.governorLimits.snapshots.length > 0;

  const soql = new Map<string, RowGroup>();
  const dml = new Map<string, RowGroup>();
  let worstSearchRows = 0;
  for (const statement of overview.ranked) {
    if (statement.kind === 'SOSL') {
      worstSearchRows = Math.max(worstSearchRows, statement.maxRows);
    } else if (statement.rows > 0) {
      addRows(statement.kind === 'SOQL' ? soql : dml, statement);
    }
  }

  return {
    budgets: [
      budgetOf('SOQL', soql, limits.queryRows, hasLimits ? limits.queryRows.used : null),
      budgetOf('DML', dml, limits.dmlRows, hasLimits ? limits.dmlRows.used : null),
    ],
    // With one limit holding every row the roll-up says nothing the budget does not.
    objects: soql.size > 0 && dml.size > 0 ? objectRows(soql, dml) : [],
    counts: [
      count('SOQL', limits.soqlQueries, overview.time.soql.statements, hasLimits),
      count('DML', limits.dmlStatements, overview.time.dml.statements, hasLimits),
      count('SOSL', limits.soslQueries, overview.time.sosl.statements, hasLimits),
    ],
    worstSearch:
      worstSearchRows > 0 ? { rows: worstSearchRows, limit: SOSL_ROWS_PER_QUERY_LIMIT } : null,
    hasLimits,
    statements: overview.ranked.length,
  };
}

function addRows(groups: Map<string, RowGroup>, statement: DatabaseStatement): void {
  const sObject = statement.sObject ?? UNKNOWN_OBJECT;
  const group = groups.get(sObject);
  if (group) {
    group.rows += statement.rows;
    group.statements += statement.repeats;
  } else {
    groups.set(sObject, { sObject, rows: statement.rows, statements: statement.repeats });
  }
}

/**
 * The two budgets rolled up per SObject. An object both read and written appears
 * in each, and only here do its two halves meet. The two sides name the object
 * from separate sources, so they can disagree on case; the unknown label is a
 * bucket of objects, not one object, so it holds no roll-up.
 */
function objectRows(soql: Map<string, RowGroup>, dml: Map<string, RowGroup>): ObjectRows[] {
  const merged = new Map<string, ObjectRows>();
  const addSide = (groups: Map<string, RowGroup>, side: 'rowsRead' | 'rowsWritten'): void => {
    for (const group of groups.values()) {
      if (group.sObject === UNKNOWN_OBJECT) {
        continue;
      }
      const key = group.sObject.toLowerCase();
      const object = merged.get(key) ?? {
        sObject: group.sObject,
        rowsRead: 0,
        rowsWritten: 0,
        rows: 0,
      };
      object[side] += group.rows;
      object.rows += group.rows;
      merged.set(key, object);
    }
  };
  addSide(soql, 'rowsRead');
  addSide(dml, 'rowsWritten');
  return [...merged.values()].sort((a, b) => b.rows - a.rows);
}

/** The governor's count where the log holds one, else what the tree showed. */
function count(
  label: string,
  total: { used: number; limit: number },
  observed: number,
  hasLimits: boolean,
): RowCount {
  return { label, used: hasLimits ? total.used : observed, limit: total.limit };
}

function budgetOf(
  kind: RowBudgetKind,
  groups: Map<string, RowGroup>,
  total: { used: number; limit: number },
  used: number | null,
): RowBudget {
  const ranked = [...groups.values()].sort((a, b) => b.rows - a.rows);
  return {
    kind,
    used,
    observed: ranked.reduce((rows, group) => rows + group.rows, 0),
    limit: total.limit,
    groups: ranked,
  };
}
