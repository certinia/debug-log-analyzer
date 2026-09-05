/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type {
  ApexLog,
  DMLBeginLine,
  Limits,
  LogEvent,
  SOQLExecuteBeginLine,
} from 'apex-log-parser';

import { GOVERNOR_METRICS, limitTotals } from '../../../components/logOverviewMetrics.js';
import { formatByteSize, formatDuration, formatInteger } from '../../../core/utility/Util.js';
import { getEventKey } from '../../../core/log/eventKeys.js';
import { currentLogStore } from '../../../core/log/LogStore.js';
import { outermostEvents } from '../../../core/utility/EventTree.js';
import { deriveSoqlObject } from '../../database/services/sobjectClassification.js';
import type { Dialect } from '../../soql/format/tokenize.js';
import { apexLimitTimeSeries } from '../../timeline/optimised/apex-limit-series.js';
import {
  QueryPlanCostRule,
  SEVERITY_TYPES,
  SOQLLinter,
  TableScanRule,
  type Severity,
} from '../../soql/services/SOQLLinter.js';

/** How many times a statement has to repeat before it is worth reporting. */
const REPEAT_THRESHOLD = 5;
/** How many debug statements make the log's own cost worth reporting. */
const DEBUG_THRESHOLD = 50;
/** Share of a governor limit that counts as near it. */
const NEAR_LIMIT_RATIO = 0.8;
/** Share of the log's self time that makes one signature worth naming as the cause. */
const HOT_SPOT_SHARE = 0.2;
/**
 * How many distinct queries the SOQL linter parses. Each parse is an antlr run,
 * so a log with thousands of distinct queries would break the panel's budget.
 * The most repeated queries are kept, and {@link LogDiagnostics.lintedQueries}
 * reports what was covered so the cap is never silent.
 */
const MAX_LINTED_QUERIES = 250;

/**
 * Where a finding sits in its severity band, ahead of any count. Truncation
 * caveats every figure below it, and a governor limit is the transaction's
 * hardest constraint — while every governor finding carries a count of 1, so
 * counting alone would bury it under whatever repeated most.
 */
const TIER = { truncation: 0, limit: 1, other: 2 } as const;
type DiagnosticTier = (typeof TIER)[keyof typeof TIER];

/**
 * What is behind a finding, when the log names one thing: what it is, and the
 * figures for it. Structured rather than folded into the prose, so the figures
 * read as figures.
 */
export interface DiagnosticCause {
  /** What the named thing is to this finding, e.g. `Most time in`. */
  label: string;
  /** The code the log named. */
  name: string;
  /** Its figures, already formatted, e.g. `11.3 s (46%)`. */
  value: string;
}

/**
 * A log line behind a finding — the statement it read, or the frame the
 * transaction stopped on — and the event it points at. Without one a finding
 * names a problem the reader cannot tie back to anything.
 */
export interface DiagnosticEvidence {
  text: string;
  /** The event it points at, or -1 when it names no single event. */
  eventIndex: number;
  /** How many times this line ran, where the finding lists several. */
  count?: number;
  /** Set where the text is a query, so it reads as one highlighted line. */
  dialect?: Dialect;
}

/** One line of evidence, for a finding that names a single event. */
function oneLine(
  text: string | undefined,
  eventIndex: number,
  dialect?: Dialect,
): DiagnosticEvidence[] | undefined {
  return text ? [{ text, eventIndex, dialect }] : undefined;
}

/**
 * One finding about the log as a whole. `summary` and `message` follow
 * {@link SOQLLinterRule}: a short statement of the problem, then the
 * prescriptive detail.
 */
export interface Diagnostic {
  /** Stable key. Identical findings share one, so they group with a count. */
  id: string;
  severity: Severity;
  /** Its {@link TIER}, when it outranks the counts. Defaults to `other`. */
  tier?: DiagnosticTier;
  summary: string;
  message: string;
  /** The figure behind the finding, shown beside the summary. */
  meta?: string;
  /** How many events raised this finding. */
  count: number;
  /**
   * How long the events behind the finding took, where the log times them. A
   * count says how often something happened; this says whether it mattered. Left
   * unset where the log measures nothing — a debug statement carries no duration.
   */
  timeNs?: number;
  /** The first event that raised it, or -1 when the finding is log-wide. */
  eventIndex: number;
  /**
   * The lines of the log behind the finding. Most findings name one; a finding
   * about a statement written several ways names each of them, so the reader can
   * open any one of them in the grid.
   */
  evidence?: DiagnosticEvidence[];
  /** The one thing behind the finding, when the log names one. */
  cause?: DiagnosticCause;
}

export interface LogDiagnostics {
  /**
   * Findings, highest severity first, then by {@link TIER}, then most frequent.
   */
  diagnostics: Diagnostic[];
  /**
   * False when the log holds no query plan lines. The plans need FINEST database
   * logging, and their absence says nothing about the queries — so the pane must
   * report it rather than leave the queries looking clean.
   */
  queryPlansKnown: boolean;
  /** Distinct queries seen, and how many of them the linter parsed. */
  lintedQueries: { linted: number; distinct: number };
  /** The whole log's duration, so a finding's {@link Diagnostic.timeNs} has a scale. */
  logNs: number;
}

const EMPTY: LogDiagnostics = {
  diagnostics: [],
  queryPlansKnown: false,
  lintedQueries: { linted: 0, distinct: 0 },
  logNs: 0,
};

/** A grouped set of events, keyed by whatever makes two of them the same finding. */
interface Group {
  count: number;
  eventIndex: number;
  events: LogEvent[];
}

/** How long a set of events took between them, an event inside another counted once. */
function totalTime(events: readonly LogEvent[]): number {
  return outermostEvents(events).reduce((sum, event) => sum + event.duration.total, 0);
}

function groupBy(events: LogEvent[], key: (event: LogEvent) => string | null): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const event of events) {
    const id = key(event);
    if (id === null) {
      continue;
    }
    const group = groups.get(id);
    if (group) {
      group.count++;
      group.events.push(event);
    } else {
      groups.set(id, { count: 1, eventIndex: event.eventIndex, events: [event] });
    }
  }
  return groups;
}

/** How each metric's figures read. Bytes and milliseconds are not bare counts. */
const LIMIT_FORMATS: Partial<Record<keyof Limits, (value: number) => string>> = {
  heapSize: formatByteSize,
  cpuTime: (value) => `${formatInteger(value)} ms`,
};

/**
 * The metric a `System.LimitException` names, in the platform's own wording. The
 * exception and the cumulative total are the same fact, so the mapping lets the
 * pane report it once.
 */
const LIMIT_EXCEPTION_METRICS: ReadonlyArray<{ key: keyof Limits; phrase: string }> = [
  { key: 'cpuTime', phrase: 'apex cpu time' },
  { key: 'heapSize', phrase: 'apex heap size' },
  { key: 'soqlQueries', phrase: 'too many soql queries' },
  { key: 'queryRows', phrase: 'too many query rows' },
  { key: 'dmlStatements', phrase: 'too many dml statements' },
  { key: 'dmlRows', phrase: 'too many dml rows' },
  { key: 'soslQueries', phrase: 'too many sosl queries' },
  { key: 'callouts', phrase: 'too many callouts' },
  { key: 'emailInvocations', phrase: 'too many email invocations' },
  { key: 'futureCalls', phrase: 'too many future calls' },
  { key: 'queueableJobsAddedToQueue', phrase: 'too many queueable jobs' },
];

/** The heaviest event by self time, and its share of all the self time in the log. */
interface HotSpot {
  label: string;
  selfNs: number;
  share: number;
}

/**
 * The one event signature that most of the log's own time went into.
 *
 * This answers the question a breach raises next — where the time went — without
 * putting a second grid beside the one already on screen. Nothing is reported
 * when no signature stands out, because then there is nothing to point at.
 */
function hotSpot(selfTime: Map<string, number>, totalSelf: number): HotSpot | null {
  if (totalSelf <= 0) {
    return null;
  }
  let label = '';
  let selfNs = 0;
  for (const [key, self] of selfTime) {
    if (self > selfNs) {
      label = key;
      selfNs = self;
    }
  }
  const share = selfNs / totalSelf;
  if (share < HOT_SPOT_SHARE) {
    return null;
  }
  // `getEventKey` is `type|namespace|text`; only the text names the code.
  return { label: label.slice(label.lastIndexOf('|') + 1), selfNs, share };
}

/**
 * The method the log was running when the event happened.
 *
 * An exception and a breach are both raised inside code, and that code is the
 * cause the reader wants: the exception row itself takes no time and says only
 * that the transaction ended. The log root is skipped, since it is not code.
 */
function enclosingFrame(event: LogEvent): LogEvent | null {
  let node = event.parent;
  while (node) {
    if (node.isParent && node.parent) {
      return node;
    }
    node = node.parent;
  }
  return null;
}

/** See {@link enclosingFrame}; the event itself where the log names no frame. */
function enclosingMethodIndex(event: LogEvent): number {
  return enclosingFrame(event)?.eventIndex ?? event.eventIndex;
}

/** A governor breach the log reported as an exception, with where it stopped. */
interface Breach {
  eventIndex: number;
  frame?: string;
}

/**
 * Governor metrics at or near a limit, and the breaches the log threw for them.
 *
 * A `LimitException` is not a defect of its own: the governor raised it because a
 * metric ran out. It is therefore merged into that metric's finding, so one
 * breach is one row.
 *
 * Figures come from {@link limitTotals}, so a metric reads the same here as on
 * every other governor surface. Those figures sum usage over every namespace and,
 * without a cumulative snapshot, measure it against the synchronous defaults — so
 * a ratio alone never reads as a breach. Only a `LimitException` says the governor
 * stopped the transaction.
 *
 * @param reported - Whether the log carries a cumulative limit snapshot. Without
 *   one the limits are assumed, and a ratio over an assumed limit says nothing.
 */
function limitDiagnostics(
  totals: Limits,
  limitExceptions: LogEvent[],
  reported: boolean,
  hotSpot: HotSpot | null,
): Diagnostic[] {
  const breaches = new Map<keyof Limits, Breach>();
  const unmapped: LogEvent[] = [];
  for (const event of limitExceptions) {
    const { head, frame } = splitException(event.text);
    const lower = head.toLowerCase();
    const named = LIMIT_EXCEPTION_METRICS.find((entry) => lower.includes(entry.phrase));
    if (!named) {
      unmapped.push(event);
      continue;
    }
    // The throw and the fatal error carry the same breach; only the fatal one
    // carries a stack, so keep whichever frame the log gave us.
    const seen = breaches.get(named.key);
    breaches.set(named.key, {
      eventIndex: seen?.eventIndex ?? enclosingMethodIndex(event),
      frame: seen?.frame || frame || undefined,
    });
  }

  const found: Diagnostic[] = [];
  for (const { key, label } of GOVERNOR_METRICS) {
    const breach = breaches.get(key);
    const { used, limit } = totals[key];
    // A metric with no usage, or no limit reported, has no figures to show.
    const known = used > 0 && limit > 0;
    const ratio = known ? used / limit : 0;
    if (!breach && (!reported || ratio < NEAR_LIMIT_RATIO)) {
      continue;
    }

    const format = LIMIT_FORMATS[key] ?? formatInteger;
    const cause: DiagnosticCause | undefined =
      key === 'cpuTime' && hotSpot
        ? {
            label: 'Most time in',
            name: hotSpot.label,
            value: `${formatDuration(hotSpot.selfNs)} (${Math.round(hotSpot.share * 100)}%)`,
          }
        : undefined;
    found.push({
      id: `limit|${key}`,
      severity: breach ? 'Error' : 'Warning',
      tier: TIER.limit,
      summary: breach
        ? `${label} limit exceeded`
        : `${label} is at ${Math.round(ratio * 100)}% of its limit`,
      meta: known ? `${format(used)} / ${format(limit)}` : undefined,
      message: breach
        ? 'The governor stopped the transaction here.'
        : known
          ? `${format(used)} of ${format(limit)} used.`
          : '',
      count: 1,
      eventIndex: breach?.eventIndex ?? -1,
      evidence: oneLine(breach?.frame, breach?.eventIndex ?? -1),
      cause,
    });
  }

  // A breach whose wording we do not map still has to be reported.
  return [...found, ...exceptionDiagnostics(unmapped)];
}

/** Where the stack begins in an exception's text, when one follows it. */
const STACK_FRAME = /(?:Class|Trigger|AnonymousBlock|External entry point)[.:]/;

/**
 * The exception, split from the stack some events carry after it. The stack is
 * per throw, so grouping on the whole text would list the same problem once per
 * call path — and a stack makes a poor summary.
 *
 * Only the innermost frame is kept. It is the line the transaction stopped on,
 * which is what the reader needs; the rest of a deep or recursive stack fills the
 * pane and says nothing more.
 */
function splitException(text: string): { head: string; frame: string } {
  const match = STACK_FRAME.exec(text);
  if (!match?.index) {
    return { head: text.trim(), frame: '' };
  }
  const stack = text.slice(match.index).trim();
  return { head: text.slice(0, match.index).trim(), frame: stack.split('\n')[0]?.trim() ?? '' };
}

/**
 * Exceptions the log recorded, grouped by the exception rather than the throw.
 *
 * The parser pushes both the throw and the fatal error that followed it, so the
 * count is of throws alone; a fatal error says the transaction did not recover.
 */
function exceptionDiagnostics(exceptions: LogEvent[]): Diagnostic[] {
  const groups = groupBy(exceptions, (event) => splitException(event.text).head);
  return [...groups].map(([head, group]) => {
    const thrown = group.events.filter((event) => event.type === 'EXCEPTION_THROWN').length;
    const fatal = group.events.some((event) => event.type === 'FATAL_ERROR');
    const frame = group.events
      .map((event) => splitException(event.text).frame)
      .find((first) => first.length > 0);
    const thrownIn = group.events[0];
    const eventIndex = thrownIn ? enclosingMethodIndex(thrownIn) : group.eventIndex;
    return {
      id: `exception|${head}`,
      severity: 'Error' as Severity,
      summary: head,
      meta: fatal ? 'unhandled' : undefined,
      message: fatal
        ? 'Nothing caught this exception, so the transaction rolled back.'
        : 'Even a caught exception costs CPU time, and a thrown-and-caught exception used as flow control is expensive.',
      count: Math.max(thrown, 1),
      eventIndex,
      evidence: oneLine(frame, eventIndex),
    };
  });
}

/** The byte figure the platform put in its own `*** Skipped N bytes` line. */
const SKIPPED_BYTES = /Skipped\s+([\d,]+)\s+bytes/i;

/**
 * The log's own truncation, as the finding that caveats all the others.
 *
 * The platform drops a section of the log when it grows too large, so every
 * figure the pane reports may be an undercount. Several regions are one finding:
 * the caveat is the same and the reader acts on it once.
 */
function truncationDiagnostics(log: ApexLog): Diagnostic[] {
  const skips = log.logIssues.filter((issue) => issue.type === 'skip');
  if (!skips.length) {
    return [];
  }
  const bytes = skips.reduce((total, issue) => {
    const figure = SKIPPED_BYTES.exec(issue.description)?.[1];
    return total + (figure ? Number(figure.replaceAll(',', '')) : 0);
  }, 0);
  return [
    {
      id: 'truncated',
      severity: 'Error',
      tier: TIER.truncation,
      summary: skips.length > 1 ? `Log truncated in ${skips.length} places` : 'Log truncated',
      meta: bytes > 0 ? formatByteSize(bytes) : undefined,
      message:
        'A section of the log was skipped, so the figures here may be undercounted. Narrow the log levels, or log a smaller transaction.',
      count: skips.length,
      eventIndex: skips[0]?.eventIndex ?? -1,
    },
  ];
}

/**
 * Anomalies the parser met in the log itself, such as an entry without its exit.
 *
 * Only these are read here. The parser also files an issue per exception and per
 * fatal error, which are the same events {@link exceptionDiagnostics} and
 * {@link limitDiagnostics} already report.
 */
function logIssueDiagnostics(log: ApexLog): Diagnostic[] {
  return log.logIssues
    .filter((issue) => issue.type === 'unexpected')
    .map((issue) => ({
      id: `issue|${issue.summary}`,
      severity: 'Warning' as Severity,
      summary: issue.summary,
      message: issue.description,
      count: 1,
      eventIndex: issue.eventIndex ?? -1,
    }));
}

/**
 * Where a statement ran: the frame it ran in, and the line inside it. A line
 * number is not an identity of its own — every class has a line 214 — so two
 * classes running the same statement at the same line are two call sites.
 */
function callSite(event: LogEvent): string | null {
  return typeof event.lineNumber === 'number'
    ? `${enclosingFrame(event)?.text ?? ''}|${event.lineNumber}`
    : null;
}

/**
 * Statements that ran many times. A log has no loop markers, so it cannot say
 * "SOQL in a loop" — but "line 214 ran 340 queries" is the same signal and is
 * what a developer acts on.
 */
function repetitionDiagnostics(statements: LogEvent[], label: string): Diagnostic[] {
  const found: Diagnostic[] = [];
  // DML logs as its operation and object, so only SOQL text is a query.
  const dialect = label === 'SOQL' ? 'soql' : undefined;

  const perLine = groupBy(statements, (event) => {
    const site = callSite(event);
    return site === null ? null : `${site}|${event.text}`;
  });
  for (const [key, group] of perLine) {
    if (group.count < REPEAT_THRESHOLD) {
      continue;
    }
    // The frame names the call site; the line alone would read the same for every
    // class that happens to run its statement at that line.
    const first = group.events[0];
    const frame = first ? enclosingFrame(first)?.text : undefined;
    const line = typeof first?.lineNumber === 'number' ? `line ${first.lineNumber}` : '';
    const from = frame ?? line;
    found.push({
      id: `repeat-line|${label}|${key}`,
      severity: 'Warning',
      summary: `${group.count} ${label} statements from ${[frame, line].filter(Boolean).join(', ')}`,
      message: `Possible ${label} in a loop: it executed ${group.count} times from ${from}. Move it out of the loop and work on the whole collection at once.`,
      count: group.count,
      timeNs: totalTime(group.events),
      eventIndex: group.eventIndex,
      evidence: oneLine(group.events[0]?.text, group.eventIndex, dialect),
    });
  }

  // The same statement from several lines: one call site cannot be pointed at,
  // so the fix is to run it once and re-use the result.
  const perText = groupBy(statements, (event) => event.text);
  for (const [text, group] of perText) {
    const sites = new Set(group.events.map(callSite));
    if (group.count < REPEAT_THRESHOLD || sites.size < 2) {
      continue;
    }
    found.push({
      id: `repeat-text|${label}|${text}`,
      severity: 'Warning',
      summary: `${group.count} identical ${label} statements, from ${sites.size} lines`,
      message: `The same statement ran ${group.count} times from ${sites.size} places. Run it once and pass the result around, or work on the whole collection at once.`,
      count: group.count,
      timeNs: totalTime(group.events),
      eventIndex: group.eventIndex,
      evidence: oneLine(text, group.eventIndex, dialect),
    });
  }

  return found;
}

/** Mean rows per statement at or below which a group is working one row at a time. */
const ROW_AT_A_TIME_ROWS = 1.5;

/**
 * The values a query embeds in its own text: quoted strings, and numbers outside
 * a word. A bind is logged as its compiled name (`:tmpVar1`), so it holds no
 * value to fold and its digits are inside a word.
 */
const SOQL_LITERAL = /'(?:[^']|'')*'|\b\d+\b/g;

/** One query with the values it embeds folded away, so two calls of it match. */
function soqlShape(text: string): string {
  return text.replace(SOQL_LITERAL, '?');
}

/** Calls of one query shape, and the statements they were written as. */
interface ShapeGroup {
  object: string;
  count: number;
  rows: number;
  timeNs: number;
  eventIndex: number;
  /** Each statement as written, with how often it ran and where it first ran. */
  texts: Map<string, DiagnosticEvidence & { count: number }>;
}

/**
 * One query run per record, built by string concatenation so its values sit in
 * its own text: many calls of one shape, returning about a row each.
 *
 * {@link repetitionDiagnostics} keys on the statement text, and a compiled query
 * logs its binds as names (`WHERE Id = :tmpVar1`), so a loop over a compiled
 * query repeats one exact text and that rule already names it. Only a query built
 * as a string embeds the record's values, spreading one call site over as many
 * texts as there were records — each text below the repeat threshold, the shape
 * as a whole well past it. Hence the shape key, and hence a group of one text is
 * left to that rule.
 *
 * Queries on one object are not grouped: different fields or a different filter
 * are different queries, written that way for reasons the log cannot see.
 *
 * DML is not read here: its text is only the operation and the object, so every
 * repeat of one operation shares a text and {@link repetitionDiagnostics} has it.
 */
function rowAtATimeDiagnostics(queries: SOQLExecuteBeginLine[]): Diagnostic[] {
  const groups = new Map<string, ShapeGroup>();

  for (const query of queries) {
    const shape = soqlShape(query.text);
    let group = groups.get(shape);
    if (!group) {
      // Only sniffed once per shape: the whole group queries the same object.
      const object = deriveSoqlObject(query);
      if (!object) {
        continue;
      }
      group = {
        object,
        count: 0,
        rows: 0,
        timeNs: 0,
        eventIndex: query.eventIndex,
        texts: new Map(),
      };
      groups.set(shape, group);
    }
    group.count++;
    group.rows += query.soqlRowCount.self;
    group.timeNs += query.duration.total;
    const text = group.texts.get(query.text);
    if (text) {
      text.count++;
    } else {
      group.texts.set(query.text, { text: query.text, eventIndex: query.eventIndex, count: 1 });
    }
  }

  const found: Diagnostic[] = [];
  for (const [shape, group] of groups) {
    const { object, count, rows, texts } = group;
    // No rows is absent evidence, not a row at a time: an end line the log
    // truncated away carries the row count with it.
    if (
      count < REPEAT_THRESHOLD ||
      texts.size < 2 ||
      rows === 0 ||
      rows > count * ROW_AT_A_TIME_ROWS
    ) {
      continue;
    }
    const each = (rows / count).toFixed(1);
    const listed = [...texts.values()].sort((a, b) => b.count - a.count);
    found.push({
      id: `row-at-a-time|${shape}`,
      severity: 'Warning',
      summary: `${count} ${object} queries, one row at a time`,
      meta: `${formatInteger(rows)} rows`,
      message: `The ${count} queries returned ${formatInteger(rows)} rows between them, ${each} each, written as ${texts.size} statements that differ only in the values built into them. Query once with an \`IN :ids\` filter and map the results by key.`,
      count,
      timeNs: group.timeNs,
      eventIndex: group.eventIndex,
      evidence: listed.map(({ text, eventIndex, count: ran }) => ({
        text,
        eventIndex,
        count: ran,
        dialect: 'soql' as const,
      })),
    });
  }
  return found;
}

/** Verdicts from the platform's own query optimiser, grouped by object. */
function queryPlanDiagnostics(queries: SOQLExecuteBeginLine[]): {
  diagnostics: Diagnostic[];
  queryPlansKnown: boolean;
} {
  const costs = new Map<
    string,
    { count: number; timeNs: number; eventIndex: number; worst: number; query: string }
  >();
  const scans = new Map<
    string,
    { count: number; timeNs: number; eventIndex: number; query: string }
  >();
  let explains = 0;

  // The plan lines are children of the query they explain, so the walk keeps the
  // query itself: a verdict on an object means nothing without the statement, and
  // the query is the row the reader wants, not the plan line under it.
  for (const query of queries) {
    for (const explain of query.children) {
      explains++;
      const sObject = explain.sObjectType ?? 'the queried object';
      if (explain.relativeCost !== null && explain.relativeCost > 1) {
        const seen = costs.get(sObject);
        if (seen) {
          seen.count++;
          seen.timeNs += query.duration.total;
          if (explain.relativeCost > seen.worst) {
            seen.worst = explain.relativeCost;
            seen.query = query.text;
            seen.eventIndex = query.eventIndex;
          }
        } else {
          costs.set(sObject, {
            count: 1,
            timeNs: query.duration.total,
            eventIndex: query.eventIndex,
            worst: explain.relativeCost,
            query: query.text,
          });
        }
      }
      if (explain.leadingOperationType === 'TableScan') {
        const seen = scans.get(sObject);
        if (seen) {
          seen.count++;
          seen.timeNs += query.duration.total;
        } else {
          scans.set(sObject, {
            count: 1,
            timeNs: query.duration.total,
            eventIndex: query.eventIndex,
            query: query.text,
          });
        }
      }
    }
  }

  // The wording is the SOQL linter's, so a plan verdict reads the same here as it
  // does beside the statement in the database grids. The object is metadata.
  const diagnostics: Diagnostic[] = [
    ...[...costs].map(([sObject, group]) => {
      const rule = new QueryPlanCostRule(group.worst);
      return {
        id: `plan-cost|${sObject}`,
        severity: rule.severity,
        summary: rule.summary,
        message: rule.message,
        meta: sObject,
        count: group.count,
        timeNs: group.timeNs,
        eventIndex: group.eventIndex,
        evidence: oneLine(group.query, group.eventIndex, 'soql'),
      };
    }),
    ...[...scans].map(([sObject, group]) => {
      const rule = new TableScanRule();
      return {
        id: `plan-scan|${sObject}`,
        severity: rule.severity,
        summary: rule.summary,
        message: rule.message,
        meta: sObject,
        count: group.count,
        timeNs: group.timeNs,
        eventIndex: group.eventIndex,
        evidence: oneLine(group.query, group.eventIndex, 'soql'),
      };
    }),
  ];

  return { diagnostics, queryPlansKnown: explains > 0 };
}

/** Debug statements are not free: they cost CPU and heap even when nobody reads them. */
function debugDiagnostics(debugLines: LogEvent[]): Diagnostic[] {
  if (debugLines.length < DEBUG_THRESHOLD) {
    return [];
  }
  return [
    {
      id: 'debug-statements',
      severity: 'Info',
      summary: `${debugLines.length} debug statements ran`,
      message:
        'Each statement builds its message and writes it, whether or not anyone reads the log. Remove the ones that are no longer needed, and keep the rest behind a lower log level.',
      count: debugLines.length,
      eventIndex: debugLines[0]?.eventIndex ?? -1,
    },
  ];
}

/**
 * The shipped SOQL rules, run over the whole log. Queries are grouped by text
 * first, so each distinct query is parsed once and its findings carry the count.
 * The stack of the first occurrence is what the stack-aware rules see.
 */
async function soqlLintDiagnostics(queries: SOQLExecuteBeginLine[]): Promise<{
  diagnostics: Diagnostic[];
  lintedQueries: { linted: number; distinct: number };
}> {
  const distinct = [...groupBy(queries, (event) => event.text)]
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, MAX_LINTED_QUERIES);

  const linter = new SOQLLinter();
  const store = currentLogStore();
  const grouped = new Map<string, Diagnostic>();

  for (const [text, group] of distinct) {
    const stack = store?.stackByEventIndex(group.eventIndex).reverse() ?? [];
    for (const rule of await linter.lint(text, stack)) {
      const id = `soql|${rule.summary}`;
      const line = {
        text,
        eventIndex: group.eventIndex,
        count: group.count,
        dialect: 'soql',
      } as const;
      const seen = grouped.get(id);
      if (!seen) {
        grouped.set(id, {
          id,
          severity: rule.severity,
          summary: rule.summary,
          message: rule.message,
          count: group.count,
          timeNs: totalTime(group.events),
          eventIndex: group.eventIndex,
          evidence: [line],
        });
        continue;
      }
      // The count is executions, so a rule several queries raise reads far above
      // any one of them. Each query is listed, so the count reconciles with what
      // the reader can open. The queries arrive most-repeated first.
      seen.count += group.count;
      seen.timeNs = (seen.timeNs ?? 0) + totalTime(group.events);
      seen.evidence?.push(line);
    }
  }

  return {
    diagnostics: [...grouped.values()],
    lintedQueries: { linted: distinct.length, distinct: new Set(queries.map((q) => q.text)).size },
  };
}

/** The findings for one log, kept so a selection re-scopes without re-analysing. */
let cached: { log: ApexLog; result: Promise<LogDiagnostics> } | null = null;

/**
 * Everything the log says about itself, as one ordered findings list.
 *
 * Analysed once per log: the rules cost one pass over `eventsById` plus an antlr
 * parse per distinct query, which is too much to repeat every time the selection
 * changes. {@link scopeDiagnostics} narrows this result instead.
 */
export function computeLogDiagnostics(): Promise<LogDiagnostics> {
  const log = currentLogStore()?.log;
  if (!log) {
    return Promise.resolve(EMPTY);
  }
  if (cached?.log !== log) {
    cached = { log, result: analyse(log) };
  }
  return cached.result;
}

/**
 * The findings that name one selection: those raised inside the given events or
 * anywhere below them.
 *
 * A finding is in scope when its own event, or any line of its evidence, sits in
 * the selection's subtree — a grouped finding spans call sites, so its first
 * event alone would drop the rest. The counts and figures are the whole log's,
 * since they say how far the problem reaches beyond what is selected.
 */
export function scopeDiagnostics(
  result: LogDiagnostics,
  instances: readonly number[],
): LogDiagnostics {
  const log = currentLogStore()?.log;
  const within = new Set(instances);
  if (!log || !within.size) {
    return { ...result, diagnostics: [] };
  }
  // `eventsById` is indexed by `eventIndex`, so ancestry is a parent walk.
  const inScope = (eventIndex: number) => {
    let node: LogEvent | null | undefined = log.eventsById[eventIndex];
    while (node) {
      if (within.has(node.eventIndex)) {
        return true;
      }
      node = node.parent;
    }
    return false;
  };
  return {
    ...result,
    diagnostics: result.diagnostics.filter(
      (diagnostic) =>
        (diagnostic.eventIndex >= 0 && inScope(diagnostic.eventIndex)) ||
        (diagnostic.evidence ?? []).some(
          (line) => line.eventIndex >= 0 && inScope(line.eventIndex),
        ),
    ),
  };
}

/**
 * Nothing here infers source-level structure — a log holds no loops and no
 * source, so the findings are what ran, how often, and what the platform said
 * about it.
 */
async function analyse(log: ApexLog): Promise<LogDiagnostics> {
  const queries: SOQLExecuteBeginLine[] = [];
  const dml: DMLBeginLine[] = [];
  const debugLines: LogEvent[] = [];
  const selfTime = new Map<string, number>();
  let totalSelf = 0;
  for (const event of log.eventsById) {
    // The log itself holds the gap time, and no call stands for it.
    if (event === log) {
      continue;
    }
    switch (event.type) {
      case 'SOQL_EXECUTE_BEGIN':
        queries.push(event as SOQLExecuteBeginLine);
        break;
      case 'DML_BEGIN':
        dml.push(event as DMLBeginLine);
        break;
      case 'USER_DEBUG':
        debugLines.push(event);
        break;
      default:
        break;
    }
    const self = event.duration.self;
    if (self > 0) {
      const key = getEventKey(event);
      selfTime.set(key, (selfTime.get(key) ?? 0) + self);
      totalSelf += self;
    }
  }

  const plans = queryPlanDiagnostics(queries);
  const lint = await soqlLintDiagnostics(queries);
  // A `LimitException` belongs to its governor metric, not to the exception list.
  const isLimit = (event: LogEvent) => event.text.includes('System.LimitException');
  const limitExceptions = log.exceptions.filter(isLimit);
  const others = log.exceptions.filter((event) => !isLimit(event));
  const ranked = [
    ...truncationDiagnostics(log),
    ...limitDiagnostics(
      limitTotals(apexLimitTimeSeries(log)),
      limitExceptions,
      log.governorLimits.snapshots.length > 0,
      hotSpot(selfTime, totalSelf),
    ),
    ...logIssueDiagnostics(log),
    ...exceptionDiagnostics(others),
    ...plans.diagnostics,
    ...lint.diagnostics,
    ...repetitionDiagnostics(queries, 'SOQL'),
    ...repetitionDiagnostics(dml, 'DML'),
    ...rowAtATimeDiagnostics(queries),
    ...debugDiagnostics(debugLines),
  ].sort(
    (a, b) =>
      SEVERITY_TYPES.indexOf(a.severity) - SEVERITY_TYPES.indexOf(b.severity) ||
      (a.tier ?? TIER.other) - (b.tier ?? TIER.other) ||
      b.count - a.count,
  );

  return {
    diagnostics: ranked,
    queryPlansKnown: plans.queryPlansKnown,
    lintedQueries: lint.lintedQueries,
    logNs: log.duration.total,
  };
}
