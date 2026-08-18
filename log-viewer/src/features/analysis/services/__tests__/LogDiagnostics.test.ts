/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, GovernorLimits, LogEvent, Limits } from 'apex-log-parser';
import { beforeEach, describe, expect, it } from '@jest/globals';

import { emptyLimits } from '../../../../components/__tests__/limitsTestUtils.js';

let log: ApexLog | null = null;

jest.mock('../../../../core/log/LogStore.js', () => ({
  currentLogStore: () => (log ? { log, stackByEventIndex: () => [] } : null),
}));

import { computeLogDiagnostics, scopeDiagnostics } from '../LogDiagnostics.js';

/** A parsed event, with only the fields the diagnostics read. */
function event(fields: Partial<LogEvent>): LogEvent {
  // The engine reads a handful of fields; a real parser event needs a parser.
  return {
    eventIndex: 0,
    text: '',
    lineNumber: null,
    children: [],
    duration: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    ...fields,
  } as LogEvent;
}

/**
 * One cumulative snapshot per namespace, as a log reports `LIMIT_USAGE_FOR_NS`.
 * The findings read the metric-strip series, which is built from these.
 */
function governorLimitsOf(namespaceLimits: Record<string, Limits>): GovernorLimits {
  const byNamespace = new Map(Object.entries(namespaceLimits));
  return {
    ...emptyLimits(),
    byNamespace,
    snapshots: [...byNamespace].map(([namespace, limits], index) => ({
      timestamp: index + 1,
      namespace,
      limits,
    })),
  } as GovernorLimits;
}

function apexLog(fields: Partial<ApexLog> & { namespaceLimits?: Record<string, Limits> }): ApexLog {
  const { namespaceLimits, ...rest } = fields;
  // Same reason as `event`: only the fields the engine reads are supplied.
  return {
    eventsById: [],
    children: [],
    exceptions: [],
    logIssues: [],
    duration: { self: 0, total: 0 },
    governorLimits: governorLimitsOf(namespaceLimits ?? {}),
    ...rest,
  } as ApexLog;
}

const soql = (fields: Partial<LogEvent>) => event({ type: 'SOQL_EXECUTE_BEGIN', ...fields });

const dml = (fields: Partial<LogEvent> & { sObjectType?: string }) =>
  event({ type: 'DML_BEGIN', ...fields } as Partial<LogEvent>);

describe('computeLogDiagnostics', () => {
  beforeEach(() => {
    log = null;
  });

  it('returns nothing while no log is parsed', async () => {
    const result = await computeLogDiagnostics();
    expect(result.diagnostics).toEqual([]);
    expect(result.queryPlansKnown).toBe(false);
  });

  it('reports a governor limit that is reached, and one that is near', async () => {
    const namespaceLimits = emptyLimits();
    namespaceLimits.cpuTime = { used: 10_000, limit: 10_000 };
    namespaceLimits.soqlQueries = { used: 85, limit: 100 };
    log = apexLog({ namespaceLimits: { default: namespaceLimits } });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.map((d) => [d.severity, d.summary, d.meta])).toEqual([
      ['Warning', 'CPU Time is at 100% of its limit', '10,000 ms / 10,000 ms'],
      ['Warning', 'SOQL is at 85% of its limit', '85 / 100'],
    ]);
  });

  it('leaves every limit alone when the log reports no cumulative totals', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 3 }, (_, index) =>
        event({ type: 'METHOD_ENTRY', eventIndex: index, duration: { self: 9e9, total: 9e9 } }),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.some((d) => d.id.startsWith('limit|'))).toBe(false);
  });

  it('leaves a metric below the near-limit share out', async () => {
    const namespaceLimits = emptyLimits();
    namespaceLimits.soqlQueries = { used: 40, limit: 100 };
    log = apexLog({ namespaceLimits: { default: namespaceLimits } });

    expect((await computeLogDiagnostics()).diagnostics).toEqual([]);
  });

  it('sums usage over every namespace, since a limit is shared unless a package is certified', async () => {
    const forNamespace = (used: number) => {
      const limits = emptyLimits();
      limits.soqlQueries = { used, limit: 100 };
      return limits;
    };
    log = apexLog({ namespaceLimits: { default: forNamespace(14), pkg: forNamespace(173) } });

    const { diagnostics } = await computeLogDiagnostics();
    // A summed share can pass 100% without a breach: a certified package has its
    // own limits. Only the log saying the governor stopped it makes that an error.
    expect(diagnostics.map((d) => [d.severity, d.summary, d.meta])).toEqual([
      ['Warning', 'SOQL is at 187% of its limit', '187 / 100'],
    ]);
  });

  it('heads a severity band with the governor limit, whatever the counts below it', async () => {
    const namespaceLimits = emptyLimits();
    namespaceLimits.soqlQueries = { used: 85, limit: 100 };
    log = apexLog({
      namespaceLimits: { default: namespaceLimits },
      eventsById: Array.from({ length: 6 }, (_, index) =>
        soql({ eventIndex: index, lineNumber: 214, text: 'SELECT Id FROM Account WHERE Id = :id' }),
      ),
    });

    const warnings = (await computeLogDiagnostics()).diagnostics.filter(
      (d) => d.severity === 'Warning',
    );
    expect(warnings[0]?.id).toBe('limit|soqlQueries');
    expect(warnings.some((d) => d.count > 1)).toBe(true);
  });

  it('groups a statement repeated from one line', async () => {
    const text = 'SELECT Id FROM Account WHERE Id = :id LIMIT 1';
    log = apexLog({
      eventsById: Array.from({ length: 6 }, (_, index) =>
        soql({ eventIndex: index, lineNumber: 214, text }),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    const repeat = diagnostics.find((d) => d.id.startsWith('repeat-line|'));
    expect(repeat?.summary).toBe('6 SOQL statements from line 214');
    expect(repeat?.count).toBe(6);
    expect(repeat?.eventIndex).toBe(0);
  });

  it('keeps a statement below the repeat threshold quiet', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 4 }, (_, index) =>
        soql({ eventIndex: index, lineNumber: 12, text: 'SELECT Id FROM Account LIMIT 1' }),
      ),
    });

    expect((await computeLogDiagnostics()).diagnostics).toEqual([]);
  });

  it('reports an identical statement that runs from several lines', async () => {
    const text = 'SELECT Id FROM Account LIMIT 1';
    log = apexLog({
      eventsById: Array.from({ length: 6 }, (_, index) =>
        soql({ eventIndex: index, lineNumber: 10 + index, text }),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    const repeat = diagnostics.find((d) => d.id.startsWith('repeat-text|'));
    expect(repeat?.summary).toBe('6 identical SOQL statements, from 6 lines');
    // Three from each of two lines would be under the per-line threshold, so the
    // per-line rule must stay quiet here.
    expect(diagnostics.some((d) => d.id.startsWith('repeat-line|'))).toBe(false);
  });

  it('leaves DML from several lines to the repeated-statement rule', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 6 }, (_, index) =>
        dml({
          eventIndex: index,
          lineNumber: 10 + index,
          text: 'DML Op:Insert Type:Account',
          sObjectType: 'Account',
          dmlRowCount: { self: 1, total: 1 },
        } as Partial<LogEvent>),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    // DML text is the operation and the object, so every repeat shares a text and
    // that rule already groups them.
    expect(diagnostics.map((d) => d.id)).toEqual(['repeat-text|DML|DML Op:Insert Type:Account']);
  });

  /** A query built as a string, so the record's id sits in its own text. */
  const dynamicSoql = (index: number, object = 'Contact') =>
    `SELECT Id FROM ${object} WHERE Id = '003a00000000${index}' LIMIT 1`;

  it('reports one query built per record, run a row at a time', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 5 }, (_, index) =>
        soql({
          eventIndex: index,
          lineNumber: 40 + index,
          text: dynamicSoql(index),
          soqlRowCount: { self: 1, total: 1 },
        } as Partial<LogEvent>),
      ),
    });

    const found = (await computeLogDiagnostics()).diagnostics.find((d) =>
      d.id.startsWith('row-at-a-time|'),
    );
    expect(found?.summary).toBe('5 Contact queries, one row at a time');
    expect(found?.message).toContain('IN :ids');
    // Each statement is listed, so the reader can open any of them in the grid.
    expect(found?.evidence).toHaveLength(5);
  });

  it('lists every statement, most repeated first, with how often each ran', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 12 }, (_, index) =>
        soql({
          eventIndex: index,
          lineNumber: 40,
          // The first statement runs twice, so it heads the list.
          text: dynamicSoql(index === 11 ? 0 : index),
          soqlRowCount: { self: 1, total: 1 },
        } as Partial<LogEvent>),
      ),
    });

    const found = (await computeLogDiagnostics()).diagnostics.find((d) =>
      d.id.startsWith('row-at-a-time|'),
    );
    expect(found?.count).toBe(12);
    expect(found?.evidence).toHaveLength(11);
    expect(found?.evidence?.[0]).toEqual({
      text: dynamicSoql(0),
      eventIndex: 0,
      count: 2,
      dialect: 'soql',
    });
    expect(found?.message).toContain('11 statements');
  });

  it('stays quiet when no rows were counted: the evidence is absent, not one row', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 5 }, (_, index) =>
        soql({
          eventIndex: index,
          lineNumber: 40 + index,
          text: dynamicSoql(index),
          soqlRowCount: { self: 0, total: 0 },
        } as Partial<LogEvent>),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.some((d) => d.id.startsWith('row-at-a-time|'))).toBe(false);
  });

  it('keeps one query built per record quiet when each returns many rows', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 6 }, (_, index) =>
        soql({
          eventIndex: index,
          lineNumber: 10 + index,
          text: `SELECT Id FROM Account WHERE Name = 'Acme ${index}'`,
          soqlRowCount: { self: 200, total: 200 },
        } as Partial<LogEvent>),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.some((d) => d.id.startsWith('row-at-a-time|'))).toBe(false);
  });

  it('leaves a bulkified query to the repeated-statement rules', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 6 }, (_, index) =>
        soql({
          eventIndex: index,
          lineNumber: 42,
          // A compiled bind logs as its name, so every call shares one text.
          text: 'SELECT Id FROM Account WHERE Id IN :idSet',
          soqlRowCount: { self: 200, total: 200 },
        } as Partial<LogEvent>),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.some((d) => d.id.startsWith('repeat-line|'))).toBe(true);
    expect(diagnostics.some((d) => d.id.startsWith('row-at-a-time|'))).toBe(false);
  });

  it('leaves statements from one line to the per-line rule', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 6 }, (_, index) =>
        soql({
          eventIndex: index,
          lineNumber: 42,
          text: 'SELECT Id FROM Account WHERE Id = :id LIMIT 1',
          soqlRowCount: { self: 1, total: 1 },
        } as Partial<LogEvent>),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.some((d) => d.id.startsWith('repeat-line|'))).toBe(true);
    expect(diagnostics.some((d) => d.id.startsWith('row-at-a-time|'))).toBe(false);
  });

  it('reports a loop on one line whose query text carries the record values', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 6 }, (_, index) =>
        soql({
          eventIndex: index,
          lineNumber: 42,
          text: dynamicSoql(index, 'Account'),
          soqlRowCount: { self: 1, total: 1 },
        } as Partial<LogEvent>),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    // Every text differs, so neither repetition rule sees the loop.
    expect(diagnostics.some((d) => d.id.startsWith('repeat-line|'))).toBe(false);
    expect(diagnostics.some((d) => d.id.startsWith('repeat-text|'))).toBe(false);
    expect(diagnostics.some((d) => d.id.startsWith('row-at-a-time|'))).toBe(true);
  });

  it('counts one line in two classes as two call sites', async () => {
    const root = event({
      type: 'EXECUTION_STARTED',
      eventIndex: 0,
      isParent: true,
    } as Partial<LogEvent>);
    const frames = ['Class.A.run()', 'Class.B.run()'].map((text, index) =>
      event({
        type: 'METHOD_ENTRY',
        eventIndex: index + 1,
        text,
        isParent: true,
        parent: root,
      } as Partial<LogEvent>),
    );
    const statements = frames.flatMap((frame, klass) =>
      Array.from({ length: 6 }, (_, run) =>
        soql({
          eventIndex: 10 + klass * 6 + run,
          lineNumber: 42,
          text: 'SELECT Id FROM Account WHERE Id = :id LIMIT 1',
          parent: frame,
          soqlRowCount: { self: 1, total: 1 },
        } as Partial<LogEvent>),
      ),
    );
    log = apexLog({ eventsById: [root, ...frames, ...statements] });

    const { diagnostics } = await computeLogDiagnostics();
    const repeats = diagnostics.filter((d) => d.id.startsWith('repeat-line|'));
    // Line 42 in two classes is two loops, not one finding of twelve.
    expect(repeats.map((d) => d.count)).toEqual([6, 6]);
    // The frame names which of the two, where line 42 alone would not.
    expect(repeats.map((d) => d.summary)).toEqual([
      '6 SOQL statements from Class.A.run(), line 42',
      '6 SOQL statements from Class.B.run(), line 42',
    ]);
    expect(repeats[0]?.message).toContain(
      'Possible SOQL in a loop: it executed 6 times from Class.A.run().',
    );
  });

  it('leaves one identical statement from several lines to the repeated-statement rule', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 6 }, (_, index) =>
        soql({
          eventIndex: index,
          lineNumber: 40 + index,
          text: 'SELECT Id FROM Account WHERE Id = :id LIMIT 1',
          soqlRowCount: { self: 1, total: 1 },
        } as Partial<LogEvent>),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.some((d) => d.id.startsWith('repeat-text|'))).toBe(true);
    expect(diagnostics.some((d) => d.id.startsWith('row-at-a-time|'))).toBe(false);
  });

  it('runs the SOQL rules once per distinct query and carries the count', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 3 }, (_, index) =>
        soql({ eventIndex: index, text: 'SELECT Id FROM Account' }),
      ),
    });

    const { diagnostics, lintedQueries } = await computeLogDiagnostics();
    const unbounded = diagnostics.find((d) => d.summary.startsWith('SOQL is unbounded'));
    expect(unbounded?.count).toBe(3);
    // The rule names a problem; the query it read is what ties it to the grid.
    expect(unbounded?.evidence).toEqual([
      { text: 'SELECT Id FROM Account', eventIndex: 0, count: 3, dialect: 'soql' },
    ]);
    expect(lintedQueries).toEqual({ linted: 1, distinct: 1 });
  });

  it('lists every query a SOQL rule fired on, most repeated first', async () => {
    // Three queries raise the same rule, each running a different number of times.
    const texts = ['SELECT Id FROM Account', 'SELECT Id FROM Contact', 'SELECT Id FROM Lead'];
    log = apexLog({
      eventsById: texts.flatMap((text, index) =>
        Array.from({ length: 3 - index }, (_, run) => soql({ eventIndex: index * 3 + run, text })),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    const unbounded = diagnostics.find((d) => d.summary.startsWith('SOQL is unbounded'));
    // The count is executions across all three, so the list is what reconciles it.
    expect(unbounded?.count).toBe(6);
    expect(unbounded?.evidence?.map((e) => [e.text, e.count])).toEqual([
      [texts[0], 3],
      [texts[1], 2],
      [texts[2], 1],
    ]);
  });

  it('reads the query plan verdicts, and knows when there are none', async () => {
    const explain = event({
      type: 'SOQL_EXECUTE_EXPLAIN',
      eventIndex: 1,
      relativeCost: 2.5,
      leadingOperationType: 'TableScan',
      sObjectType: 'Account',
    } as Partial<LogEvent>);
    log = apexLog({
      eventsById: [soql({ text: 'SELECT Id FROM Account LIMIT 1', children: [explain] })],
    });

    const { diagnostics, queryPlansKnown } = await computeLogDiagnostics();
    expect(queryPlansKnown).toBe(true);
    expect(diagnostics.map((d) => [d.summary, d.meta])).toEqual([
      ['Query is not selective.', 'Account'],
      ['Full table scan.', 'Account'],
    ]);
    expect(diagnostics.map((d) => d.evidence?.map((e) => e.text))).toEqual([
      ['SELECT Id FROM Account LIMIT 1'],
      ['SELECT Id FROM Account LIMIT 1'],
    ]);
    // The query is the row to reveal, not the plan line under it (eventIndex 1).
    expect(diagnostics.map((d) => d.eventIndex)).toEqual([0, 0]);
  });

  it('says the plans are unknown when the log holds none', async () => {
    log = apexLog({ eventsById: [soql({ text: 'SELECT Id FROM Account LIMIT 1' })] });
    expect((await computeLogDiagnostics()).queryPlansKnown).toBe(false);
  });

  it('heads the findings with a truncated log, ahead of the other issues', async () => {
    log = apexLog({
      logIssues: [
        {
          summary: 'Unexpected-End',
          description: 'An entry event was found without a corresponding exit event',
          type: 'unexpected',
        },
        {
          summary: 'Max-Size-reached',
          description: 'The maximum log size has been reached. Part of the log has been truncated.',
          type: 'skip',
        },
      ],
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.map((d) => d.summary)).toEqual(['Log truncated', 'Unexpected-End']);
    expect(diagnostics[0]?.severity).toBe('Error');
    expect(diagnostics[0]?.meta).toBeUndefined();
    expect(diagnostics[0]?.message).toContain('may be undercounted');
  });

  it('sums the bytes the log said it skipped, over every skipped region', async () => {
    const skipped = (bytes: string) => ({
      summary: 'Skipped-Lines',
      description: `*** Skipped ${bytes} bytes of detailed log. A section of the log has been skipped and the log has been truncated.`,
      type: 'skip' as const,
    });
    log = apexLog({ logIssues: [skipped('1,000,000'), skipped('2,000,000')] });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics[0]?.summary).toBe('Log truncated in 2 places');
    expect(diagnostics[0]?.meta).toBe('3 MB');
  });

  it('groups exceptions by their text, counting the throws', async () => {
    const text = 'System.NullPointerException: Attempt to de-reference a null object';
    const thrown = (eventIndex: number) => event({ type: 'EXCEPTION_THROWN', eventIndex, text });
    log = apexLog({ exceptions: [thrown(4), thrown(9)] });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.count).toBe(2);
    expect(diagnostics[0]?.eventIndex).toBe(4);
    expect(diagnostics[0]?.evidence).toBeUndefined();
  });

  it('groups the same exception thrown from different places, and keeps the frame', async () => {
    const message = 'System.NullPointerException: Attempt to de-reference a null object';
    log = apexLog({
      exceptions: [
        event({
          type: 'EXCEPTION_THROWN',
          eventIndex: 4,
          text: `${message}\nClass.A.run: line 31, column 1`,
        }),
        event({
          type: 'EXCEPTION_THROWN',
          eventIndex: 9,
          text: `${message}\nClass.B.run: line 7, column 1`,
        }),
      ],
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.summary).toBe(message);
    expect(diagnostics[0]?.count).toBe(2);
    expect(diagnostics[0]?.evidence?.[0]?.text).toBe('Class.A.run: line 31, column 1');
  });

  it('marks an exception nothing caught', async () => {
    const message = 'System.NullPointerException: Attempt to de-reference a null object';
    log = apexLog({
      exceptions: [
        event({ type: 'EXCEPTION_THROWN', eventIndex: 4, text: message }),
        event({ type: 'FATAL_ERROR', eventIndex: 5, text: message }),
      ],
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics).toHaveLength(1);
    // One throw, reported once: the fatal error is that same throw escaping.
    expect(diagnostics[0]?.count).toBe(1);
    expect(diagnostics[0]?.meta).toBe('unhandled');
  });

  it('reports a limit exception as the governor breach it is, not as an exception', async () => {
    const message = 'System.LimitException: Apex CPU time limit exceeded';
    const namespaceLimits = emptyLimits();
    namespaceLimits.cpuTime = { used: 15_163, limit: 10_000 };
    log = apexLog({
      namespaceLimits: { default: namespaceLimits },
      exceptions: [
        event({ type: 'EXCEPTION_THROWN', eventIndex: 4, text: message }),
        event({
          type: 'FATAL_ERROR',
          eventIndex: 5,
          text: `${message}\nClass.A.run: line 31, column 1`,
        }),
      ],
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.summary).toBe('CPU Time limit exceeded');
    expect(diagnostics[0]?.meta).toBe('15,163 ms / 10,000 ms');
    expect(diagnostics[0]?.eventIndex).toBe(4);
    expect(diagnostics[0]?.evidence?.[0]?.text).toBe('Class.A.run: line 31, column 1');
  });

  it('still reports a limit exception when the log holds no cumulative totals', async () => {
    log = apexLog({
      exceptions: [
        event({
          type: 'EXCEPTION_THROWN',
          eventIndex: 4,
          text: 'System.LimitException: Too many SOQL queries: 101',
        }),
      ],
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.map((d) => [d.summary, d.meta])).toEqual([
      ['SOQL limit exceeded', undefined],
    ]);
  });

  it('names the method most of the self time went into, beside the CPU breach', async () => {
    const namespaceLimits = emptyLimits();
    namespaceLimits.cpuTime = { used: 15_163, limit: 10_000 };
    log = apexLog({
      namespaceLimits: { default: namespaceLimits },
      eventsById: [
        event({ type: 'METHOD_ENTRY', text: 'Slow.run()', duration: { self: 9e9, total: 9e9 } }),
        event({ type: 'METHOD_ENTRY', text: 'Fast.run()', duration: { self: 1e9, total: 1e9 } }),
      ],
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics[0]?.cause).toEqual({
      label: 'Most time in',
      name: 'Slow.run()',
      value: '9 s (90%)',
    });
  });

  it('points a breach at the method it stopped in, not at the exception row', async () => {
    const method = event({ type: 'METHOD_ENTRY', eventIndex: 2, text: 'A.run()' });
    // `isParent` marks a method; the log root is a parent too, so it is skipped.
    const root = event({ eventIndex: 0, isParent: true });
    Object.assign(method, { isParent: true, parent: root });
    log = apexLog({
      exceptions: [
        event({
          type: 'EXCEPTION_THROWN',
          eventIndex: 4,
          text: 'System.LimitException: Apex CPU time limit exceeded',
          parent: method,
        }),
      ],
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics[0]?.eventIndex).toBe(2);
  });

  it('counts debug statements once they are worth reporting', async () => {
    const debugLine = (index: number) =>
      event({ type: 'USER_DEBUG', eventIndex: index, text: 'DEBUG|hello' });
    log = apexLog({ eventsById: Array.from({ length: 49 }, (_, i) => debugLine(i)) });
    expect((await computeLogDiagnostics()).diagnostics).toEqual([]);

    log = apexLog({ eventsById: Array.from({ length: 50 }, (_, i) => debugLine(i)) });
    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics[0]?.summary).toBe('50 debug statements ran');
    expect(diagnostics[0]?.severity).toBe('Info');
  });

  it('orders findings by severity, then by how often they happened', async () => {
    const namespaceLimits = emptyLimits();
    namespaceLimits.cpuTime = { used: 9_000, limit: 10_000 };
    log = apexLog({
      namespaceLimits: { default: namespaceLimits },
      exceptions: [event({ text: 'System.QueryException: List has no rows' })],
      eventsById: Array.from({ length: 50 }, (_, index) =>
        event({ type: 'USER_DEBUG', eventIndex: index, text: 'DEBUG|hello' }),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.map((d) => d.severity)).toEqual(['Error', 'Warning', 'Info']);
  });

  it('times a finding where the log times its events, and leaves the rest untimed', async () => {
    log = apexLog({
      duration: { self: 0, total: 1_000 },
      eventsById: Array.from({ length: 6 }, (_, index) =>
        soql({
          eventIndex: index,
          lineNumber: 214,
          text: 'SELECT Id FROM Account WHERE Id = :id LIMIT 1',
          duration: { self: 50, total: 50 },
        }),
      ),
    });

    const { diagnostics, logNs } = await computeLogDiagnostics();
    expect(logNs).toBe(1_000);
    expect(diagnostics.find((d) => d.id.startsWith('repeat-line|'))?.timeNs).toBe(300);
  });

  it('leaves a debug finding untimed, since the log measures no duration for one', async () => {
    log = apexLog({
      eventsById: Array.from({ length: 50 }, (_, index) =>
        event({ type: 'USER_DEBUG', eventIndex: index, text: 'DEBUG|hello' }),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics[0]?.timeNs).toBeUndefined();
  });
});

describe('scopeDiagnostics', () => {
  /** Six repeated queries, all called from one method, plus one from elsewhere. */
  async function repeatsUnderAMethod() {
    const text = 'SELECT Id FROM Account WHERE Id = :id LIMIT 1';
    const method = event({ type: 'METHOD_ENTRY', eventIndex: 0, text: 'Slow.run()' });
    const queries = Array.from({ length: 6 }, (_, index) =>
      soql({ eventIndex: index + 1, lineNumber: 214, text, parent: method }),
    );
    method.children = queries;
    log = apexLog({ eventsById: [method, ...queries] });
    return await computeLogDiagnostics();
  }

  beforeEach(() => {
    log = null;
  });

  it('keeps a finding whose events are below the selection', async () => {
    const result = await repeatsUnderAMethod();
    expect(result.diagnostics.length).toBeGreaterThan(0);

    const scoped = scopeDiagnostics(result, [0]);
    expect(scoped.diagnostics).toEqual(result.diagnostics);
  });

  it('drops a finding the selection never reached', async () => {
    const result = await repeatsUnderAMethod();
    // A sibling frame: nothing the findings name is inside it.
    expect(scopeDiagnostics(result, [42]).diagnostics).toEqual([]);
  });

  it('keeps the log figures, so a scoped share still reads against the whole log', async () => {
    const result = await repeatsUnderAMethod();
    const scoped = scopeDiagnostics(result, [0]);
    expect(scoped.logNs).toBe(result.logNs);
    expect(scoped.lintedQueries).toEqual(result.lintedQueries);
  });

  it('scopes to nothing when no occurrences are given', async () => {
    const result = await repeatsUnderAMethod();
    expect(scopeDiagnostics(result, []).diagnostics).toEqual([]);
  });
});
