/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type {
  ApexLog,
  GovernorLimits,
  Limits,
  LogEvent,
  SOQLExecuteBeginLine,
} from 'apex-log-parser';

import { GOVERNOR_METRICS } from '../../../components/logOverviewMetrics.js';
import { DEFAULT_NAMESPACE } from '../../../core/utility/CallerNamespace.js';
import { formatByteSize, formatDuration, formatInteger } from '../../../core/utility/Util.js';
import { getEventKey } from '../../call-tree/utils/Aggregation.js';
import { DatabaseAccess } from '../../database/services/Database.js';
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
 * One finding about the log as a whole. `summary` and `message` follow
 * {@link SOQLLinterRule}: a short statement of the problem, then the
 * prescriptive detail.
 */
export interface Diagnostic {
  /** Stable key. Identical findings share one, so they group with a count. */
  id: string;
  severity: Severity;
  summary: string;
  message: string;
  /** The figure behind the finding, shown beside the summary. */
  meta?: string;
  /** How many events raised this finding. */
  count: number;
  /** The first event that raised it, or -1 when the finding is log-wide. */
  eventIndex: number;
  /**
   * The line of the log the finding points at — the statement it read, or the
   * frame the transaction stopped on. Without it a finding names a problem the
   * reader cannot tie back to anything.
   */
  evidence?: string;
  /** The one thing behind the finding, when the log names one. */
  cause?: DiagnosticCause;
}

export interface LogDiagnostics {
  /** Findings, highest severity first, then most frequent. */
  diagnostics: Diagnostic[];
  /**
   * Set when the log is truncated. Every figure below it is an undercount, so
   * this frames the whole pane rather than being one finding in it.
   */
  truncation: string | null;
  /**
   * False when the log holds no query plan lines. The plans need FINEST database
   * logging, and their absence says nothing about the queries — so the pane must
   * report it rather than leave the queries looking clean.
   */
  queryPlansKnown: boolean;
  /** Distinct queries seen, and how many of them the linter parsed. */
  lintedQueries: { linted: number; distinct: number };
}

const EMPTY: LogDiagnostics = {
  diagnostics: [],
  truncation: null,
  queryPlansKnown: false,
  lintedQueries: { linted: 0, distinct: 0 },
};

/** A grouped set of events, keyed by whatever makes two of them the same finding. */
interface Group {
  count: number;
  eventIndex: number;
  events: LogEvent[];
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
function enclosingMethodIndex(event: LogEvent): number {
  let node = event.parent;
  while (node) {
    if (node.isParent && node.parent) {
      return node.eventIndex;
    }
    node = node.parent;
  }
  return event.eventIndex;
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
 * Only the default namespace is read. A log reports usage per namespace, but not
 * whether a package is certified — and only a certified package gets a budget of
 * its own. Some metrics, CPU time among them, are shared whatever the namespace.
 * A per-namespace figure against a per-namespace limit would therefore be a
 * guess, so this reports the one scope the log makes certain (#862).
 */
function limitDiagnostics(
  limits: GovernorLimits,
  limitExceptions: LogEvent[],
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

  const forNamespace = limits.byNamespace.get(DEFAULT_NAMESPACE);
  const found: Diagnostic[] = [];
  for (const { key, label } of GOVERNOR_METRICS) {
    const breach = breaches.get(key);
    const metric = forNamespace?.[key];
    const known = metric && metric.limit > 0 && metric.used > 0;
    const ratio = known ? metric.used / metric.limit : 0;
    if (!breach && (!known || ratio < NEAR_LIMIT_RATIO)) {
      continue;
    }

    const format = LIMIT_FORMATS[key] ?? formatInteger;
    const exceeded = breach !== undefined || ratio >= 1;
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
      severity: exceeded ? 'Error' : 'Warning',
      summary: exceeded
        ? `${label} limit exceeded.`
        : `${label} is at ${Math.round(ratio * 100)}% of its limit.`,
      meta: known ? `${format(metric.used)} / ${format(metric.limit)}` : undefined,
      message: breach
        ? 'The governor stopped the transaction here.'
        : known
          ? `${format(metric.used)} of ${format(metric.limit)} used.`
          : '',
      count: 1,
      eventIndex: breach?.eventIndex ?? -1,
      evidence: breach?.frame,
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
    return {
      id: `exception|${head}`,
      severity: 'Error' as Severity,
      summary: head,
      meta: fatal ? 'unhandled' : undefined,
      message: fatal
        ? 'Nothing caught this exception, so the transaction rolled back.'
        : 'Even a caught exception costs CPU time, and a thrown-and-caught exception used as flow control is expensive.',
      count: Math.max(thrown, 1),
      eventIndex: thrownIn ? enclosingMethodIndex(thrownIn) : group.eventIndex,
      evidence: frame,
    };
  });
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
 * Statements that ran many times. A log has no loop markers, so it cannot say
 * "SOQL in a loop" — but "line 214 ran 340 queries" is the same signal and is
 * what a developer acts on.
 */
function repetitionDiagnostics(statements: LogEvent[], label: string): Diagnostic[] {
  const found: Diagnostic[] = [];

  const perLine = groupBy(statements, (event) =>
    typeof event.lineNumber === 'number' ? `${event.lineNumber}|${event.text}` : null,
  );
  for (const [key, group] of perLine) {
    if (group.count < REPEAT_THRESHOLD) {
      continue;
    }
    found.push({
      id: `repeat-line|${label}|${key}`,
      severity: 'Warning',
      summary: `${group.count} ${label} statements from line ${group.events[0]?.lineNumber}.`,
      message: `The same statement ran ${group.count} times from one line, which is the usual sign of ${label} inside a loop. Move it out of the loop and work on the whole collection at once.`,
      count: group.count,
      eventIndex: group.eventIndex,
      evidence: group.events[0]?.text,
    });
  }

  // The same statement from several lines: one call site cannot be pointed at,
  // so the fix is to run it once and re-use the result.
  const perText = groupBy(statements, (event) => event.text);
  for (const [text, group] of perText) {
    const lines = new Set(group.events.map((event) => event.lineNumber));
    if (group.count < REPEAT_THRESHOLD || lines.size < 2) {
      continue;
    }
    found.push({
      id: `repeat-text|${label}|${text}`,
      severity: 'Warning',
      summary: `${group.count} identical ${label} statements, from ${lines.size} lines.`,
      message: `The same statement ran ${group.count} times from ${lines.size} places. Run it once and pass the result around, or cache it for the transaction.`,
      count: group.count,
      eventIndex: group.eventIndex,
      evidence: text,
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
    { count: number; eventIndex: number; worst: number; query: string }
  >();
  const scans = new Map<string, { count: number; eventIndex: number; query: string }>();
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
          if (explain.relativeCost > seen.worst) {
            seen.worst = explain.relativeCost;
            seen.query = query.text;
            seen.eventIndex = query.eventIndex;
          }
        } else {
          costs.set(sObject, {
            count: 1,
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
        } else {
          scans.set(sObject, { count: 1, eventIndex: query.eventIndex, query: query.text });
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
        eventIndex: group.eventIndex,
        evidence: group.query,
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
        eventIndex: group.eventIndex,
        evidence: group.query,
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
      summary: `${debugLines.length} debug statements ran.`,
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
  const database = DatabaseAccess.instance();
  const grouped = new Map<string, Diagnostic>();

  for (const [text, group] of distinct) {
    const stack = database?.getStackByEventIndex(group.eventIndex).reverse() ?? [];
    for (const rule of await linter.lint(text, stack)) {
      const id = `soql|${rule.summary}`;
      const seen = grouped.get(id);
      if (seen) {
        seen.count += group.count;
      } else {
        grouped.set(id, {
          id,
          severity: rule.severity,
          summary: rule.summary,
          message: rule.message,
          count: group.count,
          eventIndex: group.eventIndex,
          // The queries are in most-repeated order, so this is the query the rule
          // fired on most — what the finding is about.
          evidence: text,
        });
      }
    }
  }

  return {
    diagnostics: [...grouped.values()],
    lintedQueries: { linted: distinct.length, distinct: new Set(queries.map((q) => q.text)).size },
  };
}

/**
 * Everything the log says about itself, as one ordered findings list.
 *
 * Every rule reads data the parser already produced, so the whole engine is one
 * pass over `eventsById` plus one antlr parse per distinct query. Nothing here
 * infers source-level structure — a log holds no loops and no source, so the
 * findings are what ran, how often, and what the platform said about it.
 */
export async function computeLogDiagnostics(): Promise<LogDiagnostics> {
  const log = DatabaseAccess.instance()?.getApexLog();
  if (!log) {
    return EMPTY;
  }

  const queries: SOQLExecuteBeginLine[] = [];
  const dml: LogEvent[] = [];
  const debugLines: LogEvent[] = [];
  const selfTime = new Map<string, number>();
  let totalSelf = 0;
  for (const event of log.eventsById) {
    switch (event.type) {
      case 'SOQL_EXECUTE_BEGIN':
        queries.push(event as SOQLExecuteBeginLine);
        break;
      case 'DML_BEGIN':
        dml.push(event);
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
  const diagnostics = [
    ...limitDiagnostics(log.governorLimits, limitExceptions, hotSpot(selfTime, totalSelf)),
    ...logIssueDiagnostics(log),
    ...exceptionDiagnostics(others),
    ...plans.diagnostics,
    ...lint.diagnostics,
    ...repetitionDiagnostics(queries, 'SOQL'),
    ...repetitionDiagnostics(dml, 'DML'),
    ...debugDiagnostics(debugLines),
  ].sort(
    (a, b) =>
      SEVERITY_TYPES.indexOf(a.severity) - SEVERITY_TYPES.indexOf(b.severity) || b.count - a.count,
  );

  const truncation = log.logIssues.find((issue) => issue.type === 'skip');
  return {
    diagnostics,
    truncation: truncation ? truncation.description : null,
    queryPlansKnown: plans.queryPlansKnown,
    lintedQueries: lint.lintedQueries,
  };
}
