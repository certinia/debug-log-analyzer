/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, GovernorLimits, LogEvent, Limits } from 'apex-log-parser';
import { beforeEach, describe, expect, it } from '@jest/globals';

import { emptyLimits } from '../../../../components/__tests__/limitsTestUtils.js';

let log: ApexLog | null = null;

jest.mock('../../../database/services/Database.js', () => ({
  DatabaseAccess: {
    instance: () => (log ? { getApexLog: () => log, getStackByEventIndex: () => [] } : null),
  },
}));

import { computeLogDiagnostics } from '../LogDiagnostics.js';

/** A parsed event, with only the fields the diagnostics read. */
function event(fields: Partial<LogEvent>): LogEvent {
  // The engine reads a handful of fields; a real parser event needs a parser.
  return {
    eventIndex: 0,
    text: '',
    lineNumber: null,
    children: [],
    duration: { self: 0, total: 0 },
    ...fields,
  } as LogEvent;
}

function apexLog(fields: Partial<ApexLog> & { namespaceLimits?: Limits }): ApexLog {
  const { namespaceLimits, ...rest } = fields;
  const governorLimits = {
    ...emptyLimits(),
    byNamespace: new Map(namespaceLimits ? [['default', namespaceLimits]] : []),
    snapshots: [],
  } as GovernorLimits;
  // Same reason as `event`: only the fields the engine reads are supplied.
  return {
    eventsById: [],
    exceptions: [],
    logIssues: [],
    governorLimits,
    ...rest,
  } as ApexLog;
}

const soql = (fields: Partial<LogEvent>) => event({ type: 'SOQL_EXECUTE_BEGIN', ...fields });

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
    log = apexLog({ namespaceLimits });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.map((d) => [d.severity, d.summary, d.meta])).toEqual([
      ['Error', 'CPU Time limit exceeded.', '10,000 ms / 10,000 ms'],
      ['Warning', 'SOQL is at 85% of its limit.', '85 / 100'],
    ]);
  });

  it('leaves a metric below the near-limit share out', async () => {
    const namespaceLimits = emptyLimits();
    namespaceLimits.soqlQueries = { used: 40, limit: 100 };
    log = apexLog({ namespaceLimits });

    expect((await computeLogDiagnostics()).diagnostics).toEqual([]);
  });

  it('leaves another namespace alone, because the log cannot say it has its own budget', async () => {
    const namespaceLimits = emptyLimits();
    namespaceLimits.cpuTime = { used: 9_000, limit: 10_000 };
    log = apexLog({});
    log.governorLimits.byNamespace = new Map([['pkg', namespaceLimits]]);

    expect((await computeLogDiagnostics()).diagnostics).toEqual([]);
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
    expect(repeat?.summary).toBe('6 SOQL statements from line 214.');
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
    expect(repeat?.summary).toBe('6 identical SOQL statements, from 6 lines.');
    // Three from each of two lines would be under the per-line threshold, so the
    // per-line rule must stay quiet here.
    expect(diagnostics.some((d) => d.id.startsWith('repeat-line|'))).toBe(false);
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
    expect(unbounded?.evidence).toBe('SELECT Id FROM Account');
    expect(lintedQueries).toEqual({ linted: 1, distinct: 1 });
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
    expect(diagnostics.map((d) => d.evidence)).toEqual([
      'SELECT Id FROM Account LIMIT 1',
      'SELECT Id FROM Account LIMIT 1',
    ]);
    // The query is the row to reveal, not the plan line under it (eventIndex 1).
    expect(diagnostics.map((d) => d.eventIndex)).toEqual([0, 0]);
  });

  it('says the plans are unknown when the log holds none', async () => {
    log = apexLog({ eventsById: [soql({ text: 'SELECT Id FROM Account LIMIT 1' })] });
    expect((await computeLogDiagnostics()).queryPlansKnown).toBe(false);
  });

  it('frames a truncated log rather than listing it as a finding', async () => {
    log = apexLog({
      logIssues: [
        {
          summary: 'Max-Size-reached',
          description: 'The maximum log size has been reached. Part of the log has been truncated.',
          type: 'skip',
        },
        {
          summary: 'Unexpected-End',
          description: 'An entry event was found without a corresponding exit event',
          type: 'unexpected',
        },
      ],
    });

    const { diagnostics, truncation } = await computeLogDiagnostics();
    expect(truncation).toContain('maximum log size');
    expect(diagnostics.map((d) => d.summary)).toEqual(['Unexpected-End']);
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
    expect(diagnostics[0]?.evidence).toBe('Class.A.run: line 31, column 1');
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
      namespaceLimits,
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
    expect(diagnostics[0]?.summary).toBe('CPU Time limit exceeded.');
    expect(diagnostics[0]?.meta).toBe('15,163 ms / 10,000 ms');
    expect(diagnostics[0]?.eventIndex).toBe(4);
    expect(diagnostics[0]?.evidence).toBe('Class.A.run: line 31, column 1');
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
      ['SOQL limit exceeded.', undefined],
    ]);
  });

  it('names the method most of the self time went into, beside the CPU breach', async () => {
    const namespaceLimits = emptyLimits();
    namespaceLimits.cpuTime = { used: 15_163, limit: 10_000 };
    log = apexLog({
      namespaceLimits,
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
    expect(diagnostics[0]?.summary).toBe('50 debug statements ran.');
    expect(diagnostics[0]?.severity).toBe('Info');
  });

  it('orders findings by severity, then by how often they happened', async () => {
    const namespaceLimits = emptyLimits();
    namespaceLimits.cpuTime = { used: 9_000, limit: 10_000 };
    log = apexLog({
      namespaceLimits,
      exceptions: [event({ text: 'System.QueryException: List has no rows' })],
      eventsById: Array.from({ length: 50 }, (_, index) =>
        event({ type: 'USER_DEBUG', eventIndex: index, text: 'DEBUG|hello' }),
      ),
    });

    const { diagnostics } = await computeLogDiagnostics();
    expect(diagnostics.map((d) => d.severity)).toEqual(['Error', 'Warning', 'Info']);
  });
});
