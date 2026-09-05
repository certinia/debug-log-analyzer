/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  type ApexLog,
  DMLBeginLine,
  type LogEvent,
  SOQLExecuteBeginLine,
  SOSLExecuteBeginLine,
} from 'apex-log-parser';

import { DEFAULT_NAMESPACE, getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
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
  /** The log's own duration (ns) — the denominator the total is a share of. */
  logNs: number;
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

/** Memo per log: the tree never changes after parse, the sections re-render. */
const cache = new WeakMap<ApexLog, DatabaseOverview>();

/** {@link DatabaseOverview} for a parsed log, computed once. */
export function databaseOverview(root: ApexLog): DatabaseOverview {
  const cached = cache.get(root);
  if (cached) {
    return cached;
  }
  const overview = compute(root);
  cache.set(root, overview);
  return overview;
}

/** The DML operation from a `DML Op:Insert Type:Account` line. */
export function dmlOperation(text: string): string {
  return /\bOp:(\w+)/.exec(text)?.[1] ?? 'DML';
}

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
    if ((held / databaseNs) * 100 >= target) {
      break;
    }
  }
  return { count, percent: (held / databaseNs) * 100 };
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
}

/** The statement a log event is, or `null` for any other frame. */
function statementOf(event: LogEvent): StatementFacts | null {
  if (event instanceof SOQLExecuteBeginLine) {
    return { kind: 'SOQL', label: event.text, rowsRead: event.soqlRowCount.self, rowsWritten: 0 };
  }
  if (event instanceof DMLBeginLine) {
    return {
      kind: 'DML',
      label: `${dmlOperation(event.text)} ${event.sObjectType ?? UNKNOWN_OBJECT}`,
      rowsRead: 0,
      rowsWritten: event.dmlRowCount.self,
    };
  }
  if (event instanceof SOSLExecuteBeginLine) {
    return { kind: 'SOSL', label: event.text, rowsRead: event.soslRowCount.self, rowsWritten: 0 };
  }
  return null;
}

function compute(root: ApexLog): DatabaseOverview {
  const logNs = root.duration.total;
  const time: DatabaseTime = {
    timeNs: 0,
    logNs,
    percentOfLog: 0,
    soql: { timeNs: 0, statements: 0 },
    dml: { timeNs: 0, statements: 0 },
    sosl: { timeNs: 0, statements: 0 },
  };
  const found: { event: LogEvent; facts: StatementFacts; enclosing: LogEvent | null }[] = [];
  /** Time a statement holds in the statements inside it, so self time can net it off. */
  const nested = new Map<LogEvent, number>();
  /** Every statement found, so the tree walk classifies each event only once. */
  const factsByEvent = new Map<LogEvent, StatementFacts>();

  // Iterative: log depth is unbounded. Each frame carries the statement around
  // it, so a nested statement is found without walking back up its parents.
  const stack: { event: LogEvent; enclosing: LogEvent | null }[] = root.children.map((event) => ({
    event,
    enclosing: null,
  }));
  while (stack.length) {
    const { event, enclosing } = stack.pop()!; // non-empty: the loop condition just checked
    const facts = statementOf(event);
    const inside = facts ? event : enclosing;
    for (const child of event.children) {
      stack.push({ event: child, enclosing: inside });
    }
    if (!facts) {
      continue;
    }
    factsByEvent.set(event, facts);
    found.push({ event, facts, enclosing });
    if (enclosing) {
      nested.set(enclosing, (nested.get(enclosing) ?? 0) + event.duration.total);
    }
  }

  const statements = new Map<string, DatabaseStatement>();
  const askedBy = new Map<string, DatabaseBreakdown>();
  const burnedIn = new Map<string, DatabaseBreakdown>();
  const roots = new Map<string, TreeNode>();
  for (const { event, facts, enclosing } of found) {
    const { kind, rowsRead, rowsWritten } = facts;
    const timeNs = event.duration.total;
    const netNs = Math.max(0, timeNs - (nested.get(event) ?? 0));
    const kindTime = time[KIND_TIME[kind]];
    kindTime.timeNs += netNs;
    kindTime.statements += 1;
    addStatement(statements, event, facts, timeNs, netNs);
    addPath(roots, event, factsByEvent, timeNs, enclosing);
    // The statements inside this one are counted where they are found, so only an
    // outermost statement charges a namespace: its total is the whole cost.
    if (!enclosing) {
      const kindField = KIND_BREAKDOWN[kind];
      const caller = getCallerNamespace(event);
      addBreakdown(askedBy, {
        key: caller,
        kind: kindField,
        timeNs,
        statements: 1,
        rowsRead,
        rowsWritten,
      });
      addAttribution(burnedIn, event, kindField, caller, rowsRead, rowsWritten);
    }
  }

  time.timeNs = time.soql.timeNs + time.dml.timeNs + time.sosl.timeNs;
  time.percentOfLog = logNs > 0 ? (time.timeNs / logNs) * 100 : 0;

  return {
    time,
    ranked: [...statements.values()].sort((a, b) => b.netNs - a.netNs),
    tree: freeze(roots),
    askedBy: byTime(askedBy),
    burnedIn: byTime(burnedIn),
  };
}

/** The SObject a statement touched, or `null` where the log names none. */
function sobjectOf(event: LogEvent): string | null {
  if (event instanceof SOQLExecuteBeginLine) {
    return deriveSoqlObject(event);
  }
  if (event instanceof DMLBeginLine) {
    return event.sObjectType ?? null;
  }
  return null;
}

/** Merge one occurrence into its statement, so a query in a loop is one row. */
function addStatement(
  statements: Map<string, DatabaseStatement>,
  event: LogEvent,
  facts: StatementFacts,
  timeNs: number,
  netNs: number,
): void {
  const { kind, label, rowsRead, rowsWritten } = facts;
  const key = `${kind}:${label}`;
  const occurrenceRows = rowsRead + rowsWritten;
  const statement = statements.get(key);
  if (!statement) {
    statements.set(key, {
      eventIndex: event.eventIndex,
      eventIndexes: [event.eventIndex],
      kind,
      label,
      // Derived here so a query in a loop parses its SObject once, not per run.
      sObject: sobjectOf(event),
      timeNs,
      netNs,
      selfNs: event.duration.self,
      rows: occurrenceRows,
      maxRows: occurrenceRows,
      repeats: 1,
    });
    return;
  }
  // The slowest occurrence is the one a click should reveal.
  if (netNs > statement.netNs) {
    statement.eventIndex = event.eventIndex;
  }
  statement.eventIndexes.push(event.eventIndex);
  statement.timeNs += timeNs;
  statement.netNs += netNs;
  statement.selfNs += event.duration.self;
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
  event: LogEvent,
  kind: 'soqlTimeNs' | 'dmlTimeNs' | 'soslTimeNs',
  caller: string,
  rowsRead: number,
  rowsWritten: number,
): void {
  let attributed = 0;
  for (const child of event.children) {
    if (!child.isParent || child.duration.total <= 0) {
      continue;
    }
    attributed += child.duration.total;
    addBreakdown(breakdowns, {
      key: child.namespace || DEFAULT_NAMESPACE,
      kind,
      timeNs: child.duration.total,
    });
  }
  // The rows belong to the statement itself, so they follow its platform time.
  addBreakdown(breakdowns, {
    key: caller,
    kind,
    timeNs: Math.max(0, event.duration.total - attributed),
    statements: 1,
    rowsRead,
    rowsWritten,
  });
}

/** Breakdowns as a list, the namespace holding the most time first. */
function byTime(breakdowns: Map<string, DatabaseBreakdown>): DatabaseBreakdown[] {
  return [...breakdowns.values()].sort((a, b) => b.timeNs - a.timeNs);
}

/** Merge one statement and the frames above it into the tree. */
function addPath(
  roots: Map<string, TreeNode>,
  event: LogEvent,
  factsByEvent: Map<LogEvent, StatementFacts>,
  timeNs: number,
  enclosing: LogEvent | null,
): void {
  // Outermost frame first; the root itself is no frame, so it stops the walk up.
  const path: LogEvent[] = [];
  for (let frame: LogEvent | null = event; frame?.parent; frame = frame.parent) {
    // A marker line the log names after its own type — EXECUTION_STARTED — names
    // no code, so it would be a row every path shares and none of them needs.
    if (frame === event || frame.text !== frame.type) {
      path.push(frame);
    }
  }
  path.reverse();

  // The statement around this one already counts its time, so it and everything
  // above it take nothing; only the frames beneath it do.
  const cutoff = enclosing ? path.indexOf(enclosing) : -1;

  let level = roots;
  path.forEach((frame, index) => {
    const frameFacts = factsByEvent.get(frame);
    const text = frameFacts ? frameFacts.label : frame.text || frame.type || 'Unknown';
    const key = frameFacts ? `${frameFacts.kind}:${text}` : `frame:${text}`;
    let node = level.get(key);
    if (!node) {
      node = {
        label: text,
        kind: frameFacts?.kind ?? null,
        timeNs: 0,
        selfNs: 0,
        events: new Set(),
        children: new Map(),
      };
      level.set(key, node);
    }
    if (index > cutoff) {
      node.timeNs += timeNs;
    }
    // Own time comes from the frame itself, so a frame two statements both run
    // counts it once however many paths reach this node.
    if (!node.events.has(frame.eventIndex)) {
      node.selfNs += frame.duration.self;
      node.events.add(frame.eventIndex);
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
