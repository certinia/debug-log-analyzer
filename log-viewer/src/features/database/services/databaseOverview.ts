/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent } from '@apexdevtools/apex-log-parser';

import { type LogIndex, NO_ROW } from '#core/log/LogIndex.js';
import type { Derivation } from '#core/log/LogStore.js';
import { type Signatures, signaturesOf } from '#core/log/signatures.js';
import { statements, type DmlEvent, type SoqlEvent, type SoslEvent } from '#core/log/statements.js';
import { childRows } from '#core/log/windowStats.js';
import { DEFAULT_NAMESPACE, namespaceOf } from '#core/utility/CallerNamespace.js';
import { sharePercent } from '#core/utility/Util.js';
import { deriveSoqlObject } from './sobjectClassification.js';

/** The label for a DML statement whose SObject the log never names. */
export const UNKNOWN_OBJECT = 'Unknown';

/** What every whole-log Database section says when the log holds nothing. */
export const NO_STATEMENTS = 'The log records no database statements.';

/**
 * The share of database time the concentration read aims at. The first
 * statements to cross it are the ones worth fixing; everything after them is
 * tail.
 */
export const CONCENTRATION_SHARE = 75;

export type StatementKind = 'SOQL' | 'DML' | 'SOSL';

/** Time and statement count for one statement kind. */
export interface StatementKindTime {
  timeNs: number;
  statements: number;
}

/** Where the transaction's database time went, by statement kind. */
export interface DatabaseTime {
  timeNs: number;
  /** Database time as a share of the log's own duration, 0-100. */
  percentOfLog: number;
  soql: StatementKindTime;
  dml: StatementKindTime;
  sosl: StatementKindTime;
}

/**
 * One database statement and how long it took, summed across every time the log
 * ran it — the same grouping the grids show as `(3)` on a repeated statement.
 */
export interface DatabaseStatement {
  /** The slowest occurrence, so a click reveals the one worth reading. */
  eventIndex: number;
  /** Every occurrence, so hovering marks all of them in the grid. */
  eventIndexes: number[];
  kind: StatementKind;
  /** The query text, or the operation and SObject for DML. */
  label: string;
  /** The SObject the statement reads or writes, or `null` where the log names none. */
  sObject: string | null;
  /** Whole duration (ns) across every occurrence, nested statements included. */
  timeNs: number;
  /**
   * Duration (ns) net of the statements nested inside it, so the three kinds sum
   * to the database total with nothing counted twice.
   */
  netNs: number;
  /** Self time (ns): the statement line's own, every descendant excluded. */
  selfNs: number;
  rows: number;
  /** The most rows one occurrence read or wrote, for a search's per-query cap. */
  maxRows: number;
  /** Times the log ran this statement. */
  repeats: number;
}

/**
 * One frame on a call path that ends in a database statement, with the database
 * time held beneath it. Frames with the same text under the same parent merge
 * into one node, so a method called 200 times reads as one row with a count.
 */
export interface DatabaseCallNode {
  label: string;
  /** Set when the node is the statement itself, not a frame that led to one. */
  kind: StatementKind | null;
  /** Database time in this node's subtree (ns). */
  timeNs: number;
  /**
   * The code's own time (ns): the frames merged here, each less every child it
   * ran. A statement's children are its triggers, workflows and flows, so its own
   * time is the platform's save or query work; a frame's is its Apex. The two
   * columns therefore never overlap — database time below, own code here.
   */
  selfNs: number;
  /** Frames merged into this node. */
  count: number;
  /** Every occurrence, so a row can reveal and locate all of them. */
  eventIndexes: number[];
  children: DatabaseCallNode[];
}

/**
 * How few statements hold most of the database time — the verdict a sortable
 * grid cannot give, since sorting names the slowest but never says the rest do
 * not matter.
 */
export interface Concentration {
  /** Statements it takes to cross {@link CONCENTRATION_SHARE}. */
  count: number;
  /** The share those statements hold, 0-100. */
  percent: number;
}

/**
 * Database time and rows for one namespace, across all three statement kinds —
 * the cross-kind total the three separate grids cannot give.
 *
 * Which namespace depends on the question: see {@link DatabaseOverview.askedBy}
 * and {@link DatabaseOverview.burnedIn}.
 */
export interface DatabaseBreakdown {
  key: string;
  timeNs: number;
  soqlTimeNs: number;
  dmlTimeNs: number;
  soslTimeNs: number;
  statements: number;
  rowsRead: number;
  rowsWritten: number;
}

/**
 * The Database tab's whole-log figures: database time by kind, the statements
 * ranked by duration, the call paths that reach them, and time and rows by
 * namespace.
 *
 * All of it is counts and sums over one walk. Rows come from the statement lines
 * themselves, so a log missing `Rows:` reports zero rather than a guess.
 *
 * Every statement is counted, a trigger's query under a DML included: the DML's
 * total holds the query, its net time does not, and the query owns its own time.
 * Net times therefore sum to the database total, so shares of it hold whatever
 * the nesting is.
 */
export interface DatabaseOverview {
  time: DatabaseTime;
  /** Every statement, longest first, occurrences of the same one summed. */
  ranked: DatabaseStatement[];
  /** Call paths that end in a statement, outermost frames first. */
  tree: DatabaseCallNode[];
  /**
   * Who asked for the database time: each outermost statement's whole duration,
   * charged to the namespace of the code that ran it.
   */
  askedBy: DatabaseBreakdown[];
  /**
   * Where that time went: every event beneath a statement charges its own self
   * time to its own namespace, so a DML's trigger code counts against the
   * package that wrote the trigger. The platform's own save and query work — the
   * self time of the statement line itself — is charged to the caller that asked
   * for it, since no namespace executed it.
   */
  burnedIn: DatabaseBreakdown[];
}

/** {@link DatabaseOverview} for the log. */
export const databaseOverview: Derivation<DatabaseOverview> = async (index, store) =>
  compute(store.log.duration.total, index, (await store.derive(statements)).rows);

/** {@link Concentration} for an overview, against a share of database time. */
export function concentration(
  overview: DatabaseOverview,
  target = CONCENTRATION_SHARE,
): Concentration {
  const databaseNs = overview.time.timeNs;
  if (!overview.ranked.length || databaseNs <= 0) {
    return { count: 0, percent: 0 };
  }
  let held = 0;
  let count = 0;
  for (const statement of overview.ranked) {
    held += statement.netNs;
    count += 1;
    if (sharePercent(held, databaseNs) >= target) {
      break;
    }
  }
  return { count, percent: sharePercent(held, databaseNs) };
}

/** The kind's own figures on {@link DatabaseTime}. */
const KIND_TIME: Record<StatementKind, 'soql' | 'dml' | 'sosl'> = {
  SOQL: 'soql',
  DML: 'dml',
  SOSL: 'sosl',
};

/** The kind's own time field on {@link DatabaseBreakdown}. */
const KIND_BREAKDOWN: Record<StatementKind, 'soqlTimeNs' | 'dmlTimeNs' | 'soslTimeNs'> = {
  SOQL: 'soqlTimeNs',
  DML: 'dmlTimeNs',
  SOSL: 'soslTimeNs',
};

/** A node while the tree is still being merged: children keyed for lookup. */
interface TreeNode {
  label: string;
  kind: StatementKind | null;
  timeNs: number;
  selfNs: number;
  events: Set<number>;
  children: Map<string, TreeNode>;
}

/** What a log event is, when it is a database statement. */
interface StatementFacts {
  kind: StatementKind;
  label: string;
  rowsRead: number;
  rowsWritten: number;
  /** The SObject a DML names; a query's is derived once per statement, as {@link sobjectOf} does. */
  sObject: string | null;
}

/** The statement a log event is, or `null` for any other frame. */
function statementOf(event: ApexEvent): StatementFacts | null {
  // Each branch checks the type it casts to.
  switch (event.type) {
    case 'SOQL_EXECUTE_BEGIN': {
      const soql = event as SoqlEvent;
      const rowsRead = soql.soqlRowCount?.self ?? 0;
      return { kind: 'SOQL', label: soql.text ?? '', rowsRead, rowsWritten: 0, sObject: null };
    }
    case 'DML_BEGIN': {
      const { operation, sObjectType } = (event as DmlEvent).details;
      return {
        kind: 'DML',
        label: `${operation ?? 'DML'} ${sObjectType ?? UNKNOWN_OBJECT}`,
        rowsRead: 0,
        rowsWritten: event.dmlRowCount?.self ?? 0,
        sObject: sObjectType,
      };
    }
    case 'SOSL_EXECUTE_BEGIN': {
      const sosl = event as SoslEvent;
      const rowsRead = sosl.soslRowCount?.self ?? 0;
      return { kind: 'SOSL', label: sosl.text ?? '', rowsRead, rowsWritten: 0, sObject: null };
    }
    default:
      return null;
  }
}

/** What the walks read the shown rows by. */
interface Rows {
  index: LogIndex;
  signatures: Signatures;
  /** 1 for a frame, by row. */
  isFrame: Uint8Array;
}

function compute(logNs: number, index: LogIndex, rows: readonly number[]): DatabaseOverview {
  const source: Rows = {
    index,
    signatures: signaturesOf(index.log),
    isFrame: index.column(index.log.columns.isFrame),
  };
  const time: DatabaseTime = {
    timeNs: 0,
    percentOfLog: 0,
    soql: { timeNs: 0, statements: 0 },
    dml: { timeNs: 0, statements: 0 },
    sosl: { timeNs: 0, statements: 0 },
  };
  const found: {
    row: number;
    event: ApexEvent;
    facts: StatementFacts;
    /** The statement row around this one, or {@link NO_ROW}. */
    enclosing: number;
  }[] = [];
  /** Time a statement row holds in the statements inside it, so self time can net it off. */
  const nested = new Map<number, number>();
  /** Every statement found by row, so the tree walk classifies each event only once. */
  const factsByRow = new Map<number, StatementFacts>();

  // The statements still open form a stack, so its top encloses the next one.
  const { subtreeEnd, total } = index;
  const open: number[] = [];
  for (const row of rows) {
    // In range: every row in `open` is a row of `index`.
    while (open.length && subtreeEnd[open.at(-1)!]! <= row) {
      open.pop();
    }
    const event = index.event(row);
    const facts = statementOf(event)!; // every row of `statements` is a statement
    const enclosing = open.at(-1) ?? NO_ROW;
    open.push(row);
    factsByRow.set(row, facts);
    found.push({ row, event, facts, enclosing });
    if (enclosing !== NO_ROW) {
      nested.set(enclosing, (nested.get(enclosing) ?? 0) + total[row]!);
    }
  }
  // The order a last-child-first walk meets them in, which a tie below keeps.
  found.sort((a, b) => subtreeEnd[b.row]! - subtreeEnd[a.row]! || a.row - b.row);

  const statements = new Map<string, DatabaseStatement>();
  const askedBy = new Map<string, DatabaseBreakdown>();
  const burnedIn = new Map<string, DatabaseBreakdown>();
  const roots = new Map<string, TreeNode>();
  for (const { row, event, facts, enclosing } of found) {
    const { kind, rowsRead, rowsWritten } = facts;
    const timeNs = total[row]!;
    const netNs = Math.max(0, timeNs - (nested.get(row) ?? 0));
    const kindTime = time[KIND_TIME[kind]];
    kindTime.timeNs += netNs;
    kindTime.statements += 1;
    addStatement(statements, index, row, event, facts, netNs);
    addPath(roots, source, row, factsByRow, timeNs, enclosing);
    // The statements inside this one are counted where they are found, so only an
    // outermost statement charges a namespace: its total is the whole cost.
    if (enclosing === NO_ROW) {
      const kindField = KIND_BREAKDOWN[kind];
      const above = index.parent[row]!;
      const caller =
        above === NO_ROW ? DEFAULT_NAMESPACE : namespaceOf(index.log, index.eventIndex[above]!);
      addBreakdown(askedBy, {
        key: caller,
        kind: kindField,
        timeNs,
        statements: 1,
        rowsRead,
        rowsWritten,
      });
      addAttribution(burnedIn, source, row, kindField, caller, rowsRead, rowsWritten);
    }
  }

  time.timeNs = time.soql.timeNs + time.dml.timeNs + time.sosl.timeNs;
  time.percentOfLog = sharePercent(time.timeNs, logNs);

  return {
    time,
    ranked: [...statements.values()].sort((a, b) => b.netNs - a.netNs),
    tree: freeze(roots),
    askedBy: byTime(askedBy),
    burnedIn: byTime(burnedIn),
  };
}

/** The SObject a statement touched, or `null` where the log names none. */
function sobjectOf(event: ApexEvent, facts: StatementFacts): string | null {
  // The kind says the type.
  return facts.kind === 'SOQL' ? deriveSoqlObject(event as SoqlEvent) : facts.sObject;
}

/** Merge one occurrence, at `row`, into its statement, so a query in a loop is one row. */
function addStatement(
  statements: Map<string, DatabaseStatement>,
  index: LogIndex,
  row: number,
  event: ApexEvent,
  facts: StatementFacts,
  netNs: number,
): void {
  const timeNs = index.total[row]!;
  const selfNs = index.self[row]!;
  const { kind, label, rowsRead, rowsWritten } = facts;
  const key = `${kind}:${label}`;
  const occurrenceRows = rowsRead + rowsWritten;
  const statement = statements.get(key);
  if (!statement) {
    statements.set(key, {
      eventIndex: event.id,
      eventIndexes: [event.id],
      kind,
      label,
      // Derived here so a query in a loop parses its SObject once, not per run.
      sObject: sobjectOf(event, facts),
      timeNs,
      netNs,
      selfNs,
      rows: occurrenceRows,
      maxRows: occurrenceRows,
      repeats: 1,
    });
    return;
  }
  // The slowest occurrence is the one a click should reveal.
  if (netNs > statement.netNs) {
    statement.eventIndex = event.id;
  }
  statement.eventIndexes.push(event.id);
  statement.timeNs += timeNs;
  statement.netNs += netNs;
  statement.selfNs += selfNs;
  statement.rows += occurrenceRows;
  statement.maxRows = Math.max(statement.maxRows, occurrenceRows);
  statement.repeats += 1;
}

/**
 * Charge one outermost statement's total across the namespaces that ran inside
 * it. Each timed direct child — a trigger, a workflow, a flow — is charged its
 * whole duration against its own namespace; what is left over is the platform's
 * own save or query work, which no namespace executed, so it is charged to the
 * caller that asked for it.
 *
 * Direct children only: the level below a DML is the trigger or workflow, which
 * is the unit worth going to fix. Untimed marker lines are skipped.
 */
function addAttribution(
  breakdowns: Map<string, DatabaseBreakdown>,
  { index, isFrame }: Rows,
  row: number,
  kind: 'soqlTimeNs' | 'dmlTimeNs' | 'soslTimeNs',
  caller: string,
  rowsRead: number,
  rowsWritten: number,
): void {
  const { total } = index;
  let attributed = 0;
  for (const child of childRows(index, row)) {
    if (!isFrame[child] || total[child]! <= 0) {
      continue;
    }
    attributed += total[child]!;
    addBreakdown(breakdowns, {
      key: namespaceOf(index.log, index.eventIndex[child]!),
      kind,
      timeNs: total[child]!,
    });
  }
  // The rows belong to the statement itself, so they follow its platform time.
  addBreakdown(breakdowns, {
    key: caller,
    kind,
    timeNs: Math.max(0, total[row]! - attributed),
    statements: 1,
    rowsRead,
    rowsWritten,
  });
}

/** Breakdowns as a list, the namespace holding the most time first. */
function byTime(breakdowns: Map<string, DatabaseBreakdown>): DatabaseBreakdown[] {
  return [...breakdowns.values()].sort((a, b) => b.timeNs - a.timeNs);
}

/** Merge the statement at `row` and the frames above it into the tree. */
function addPath(
  roots: Map<string, TreeNode>,
  { index, signatures }: Rows,
  row: number,
  factsByRow: Map<number, StatementFacts>,
  timeNs: number,
  enclosing: number,
): void {
  const { text } = index.log.columns;
  // Outermost frame first.
  const path: number[] = [];
  for (let frame = row; frame !== NO_ROW; frame = index.parent[frame]!) {
    // A marker line that states no text — EXECUTION_STARTED — names no code, so
    // it would be a row every path shares and none of them needs.
    if (frame === row || text.at(index.eventIndex[frame]!) !== null) {
      path.push(frame);
    }
  }
  path.reverse();

  // The statement around this one already counts its time, so it and everything
  // above it take nothing; only the frames beneath it do.
  const cutoff = enclosing === NO_ROW ? -1 : path.indexOf(enclosing);

  let level = roots;
  path.forEach((frame, depth) => {
    const frameFacts = factsByRow.get(frame);
    const id = index.eventIndex[frame]!;
    const label = frameFacts ? frameFacts.label : signatures.text(signatures.of(id));
    const key = frameFacts ? `${frameFacts.kind}:${label}` : `frame:${label}`;
    let node = level.get(key);
    if (!node) {
      node = {
        label,
        kind: frameFacts?.kind ?? null,
        timeNs: 0,
        selfNs: 0,
        events: new Set(),
        children: new Map(),
      };
      level.set(key, node);
    }
    if (depth > cutoff) {
      node.timeNs += timeNs;
    }
    // Own time comes from the frame itself, so a frame two statements both run
    // counts it once however many paths reach this node.
    if (!node.events.has(id)) {
      node.selfNs += index.self[frame]!;
      node.events.add(id);
    }
    level = node.children;
  });
}

/** The merged tree as plain nodes, each level longest first. */
function freeze(roots: Map<string, TreeNode>): DatabaseCallNode[] {
  const tree: DatabaseCallNode[] = [];
  // Iterative: path depth is unbounded.
  const stack: { from: Map<string, TreeNode>; into: DatabaseCallNode[] }[] = [
    { from: roots, into: tree },
  ];
  while (stack.length) {
    const { from, into } = stack.pop()!; // non-empty: the loop condition just checked
    for (const node of [...from.values()].sort((a, b) => b.timeNs - a.timeNs)) {
      const frozen: DatabaseCallNode = {
        label: node.label,
        kind: node.kind,
        timeNs: node.timeNs,
        selfNs: node.selfNs,
        count: node.events.size,
        eventIndexes: [...node.events].sort((a, b) => a - b),
        children: [],
      };
      into.push(frozen);
      if (node.children.size) {
        stack.push({ from: node.children, into: frozen.children });
      }
    }
  }
  return tree;
}

/** Time, and the statement figures only a statement line itself carries. */
interface BreakdownEntry {
  key: string;
  kind: 'soqlTimeNs' | 'dmlTimeNs' | 'soslTimeNs';
  timeNs: number;
  statements?: number;
  rowsRead?: number;
  rowsWritten?: number;
}

function addBreakdown(
  breakdowns: Map<string, DatabaseBreakdown>,
  { key, kind, timeNs, statements = 0, rowsRead = 0, rowsWritten = 0 }: BreakdownEntry,
): void {
  let breakdown = breakdowns.get(key);
  if (!breakdown) {
    breakdown = {
      key,
      timeNs: 0,
      soqlTimeNs: 0,
      dmlTimeNs: 0,
      soslTimeNs: 0,
      statements: 0,
      rowsRead: 0,
      rowsWritten: 0,
    };
    breakdowns.set(key, breakdown);
  }
  breakdown[kind] += timeNs;
  breakdown.timeNs += timeNs;
  breakdown.statements += statements;
  breakdown.rowsRead += rowsRead;
  breakdown.rowsWritten += rowsWritten;
}
