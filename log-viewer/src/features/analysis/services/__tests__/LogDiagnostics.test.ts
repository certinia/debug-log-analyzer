/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { rawStoreOf, storeOf } from '#test-helpers/apexLog.js';
import { filterByLevels } from '#core/log/LogStore.js';
import { logDiagnostics, scopeDiagnostics } from '../LogDiagnostics.js';

/** The time of the last line {@link at} wrote. */
let clock = 0;

/** One log line, `step` nanoseconds after the last. */
function at(line: string, step = 10): string {
  clock += step;
  return `09:18:22.6 (${clock})|${line}\n`;
}

/** The findings for a log of `lines`, in that order; ids count from 1 on the first event. */
async function diagnose(...lines: string[]) {
  const { store } = await rawStoreOf(lines.join(''));
  return store.derive(logDiagnostics);
}

/** A query from `lineNumber` that returns `rows` and takes `ns`. */
function soql(lineNumber: number, text: string, rows = 0, ns = 10): string {
  return (
    at(`SOQL_EXECUTE_BEGIN|[${lineNumber}]|Aggregations:0|${text}`) +
    at(`SOQL_EXECUTE_END|[${lineNumber}]|Rows:${rows}`, ns)
  );
}

/** An insert of one Account from `lineNumber`, taking `ns`. */
function dml(lineNumber: number, ns = 10): string {
  return (
    at(`DML_BEGIN|[${lineNumber}]|Op:Insert|Type:Account|Rows:1`) +
    at(`DML_END|[${lineNumber}]`, ns)
  );
}

const debug = (): string => at('USER_DEBUG|[1]|DEBUG|hello');

/** A cumulative limit usage block, one `LIMIT_USAGE_FOR_NS` per namespace. */
function limitUsage(usage: Record<string, string[]>): string {
  return (
    at('CUMULATIVE_LIMIT_USAGE', 1) +
    Object.entries(usage)
      .map(([namespace, lines]) =>
        at(`LIMIT_USAGE_FOR_NS|${namespace}|${lines.map((line) => `\n  ${line}`).join('')}`, 1),
      )
      .join('') +
    at('CUMULATIVE_LIMIT_USAGE_END', 1)
  );
}

const soqlUsed = (used: number) => `Number of SOQL queries: ${used} out of 100`;
const cpuUsed = (used: number) => `Maximum CPU time: ${used} out of 10000`;

const skipped = (bytes: string) => `*** Skipped ${bytes} bytes of detailed log\n`;
const MAX_SIZE = '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n';

const NPE = 'System.NullPointerException: Attempt to de-reference a null object';

beforeEach(() => {
  clock = 0;
});

describe('logDiagnostics', () => {
  it('reports a governor limit that is reached, and one that is near', async () => {
    const { diagnostics } = await diagnose(
      limitUsage({ '(default)': [soqlUsed(85), 'Maximum CPU time: 10000 out of 10000'] }),
    );
    expect(diagnostics.map((d) => [d.severity, d.summary, d.meta])).toEqual([
      ['Warning', 'CPU Time is at 100% of its limit', '10,000 ms / 10,000 ms'],
      ['Warning', 'SOQL is at 85% of its limit', '85 / 100'],
    ]);
  });

  it('leaves every limit alone when the log reports no cumulative totals', async () => {
    const { diagnostics } = await diagnose(
      ...['A', 'B', 'C'].flatMap((name) => [
        at(`METHOD_ENTRY|[1]|01p|${name}.run()`),
        at(`METHOD_EXIT|[1]|${name}.run()`, 9e9),
      ]),
    );
    expect(diagnostics.some((d) => d.id.startsWith('limit|'))).toBe(false);
  });

  it('leaves a metric below the near-limit share out', async () => {
    expect((await diagnose(limitUsage({ '(default)': [soqlUsed(40)] }))).diagnostics).toEqual([]);
  });

  it('sums usage over every namespace, since a limit is shared unless a package is certified', async () => {
    const { diagnostics } = await diagnose(
      limitUsage({ '(default)': [soqlUsed(14)], pkg: [soqlUsed(173)] }),
    );
    // A summed share can pass 100% without a breach: a certified package has its
    // own limits. Only the log saying the governor stopped it makes that an error.
    expect(diagnostics.map((d) => [d.severity, d.summary, d.meta])).toEqual([
      ['Warning', 'SOQL is at 187% of its limit', '187 / 100'],
    ]);
  });

  it('heads a severity band with the governor limit, whatever the counts below it', async () => {
    const { diagnostics } = await diagnose(
      ...Array.from({ length: 6 }, () => soql(214, 'SELECT Id FROM Account WHERE Id = :id')),
      limitUsage({ '(default)': [soqlUsed(85)] }),
    );

    const warnings = diagnostics.filter((d) => d.severity === 'Warning');
    expect(warnings[0]?.id).toBe('limit|soqlQueries');
    expect(warnings.some((d) => d.count > 1)).toBe(true);
  });

  it('groups a statement repeated from one line', async () => {
    const text = 'SELECT Id FROM Account WHERE Id = :id LIMIT 1';
    const { diagnostics } = await diagnose(...Array.from({ length: 6 }, () => soql(214, text)));

    const repeat = diagnostics.find((d) => d.id.startsWith('repeat-line|'));
    expect(repeat?.summary).toBe('6 SOQL statements from line 214');
    expect(repeat?.count).toBe(6);
    // The first query is the first event.
    expect(repeat?.eventId).toBe(1);
  });

  it('keeps a statement below the repeat threshold quiet', async () => {
    const { diagnostics } = await diagnose(
      ...Array.from({ length: 4 }, () => soql(12, 'SELECT Id FROM Account LIMIT 1')),
    );
    expect(diagnostics).toEqual([]);
  });

  it('reports an identical statement that runs from several lines', async () => {
    const text = 'SELECT Id FROM Account LIMIT 1';
    const { diagnostics } = await diagnose(
      ...Array.from({ length: 6 }, (_, index) => soql(10 + index, text)),
    );

    const repeat = diagnostics.find((d) => d.id.startsWith('repeat-text|'));
    expect(repeat?.summary).toBe('6 identical SOQL statements, from 6 lines');
    // One from each line is under the per-line threshold, so the per-line rule
    // must stay quiet here.
    expect(diagnostics.some((d) => d.id.startsWith('repeat-line|'))).toBe(false);
  });

  it('leaves DML from several lines to the repeated-statement rule', async () => {
    const { diagnostics } = await diagnose(
      ...Array.from({ length: 6 }, (_, index) => dml(10 + index)),
    );
    // DML text is the operation and the object, so every repeat shares a text and
    // that rule already groups them.
    expect(diagnostics.map((d) => d.id)).toEqual(['repeat-text|DML|DML Op:Insert Type:Account']);
  });

  /** A query built as a string, so the record's id sits in its own text. */
  const dynamicSoql = (index: number, object = 'Contact') =>
    `SELECT Id FROM ${object} WHERE Id = '003a00000000${index}' LIMIT 1`;

  it('reports one query built per record, run a row at a time', async () => {
    const { diagnostics } = await diagnose(
      ...Array.from({ length: 5 }, (_, index) => soql(40 + index, dynamicSoql(index), 1)),
    );

    const found = diagnostics.find((d) => d.id.startsWith('row-at-a-time|'));
    expect(found?.summary).toBe('5 Contact queries, one row at a time');
    expect(found?.message).toContain('IN :ids');
    // Each statement is listed, so the reader can open any of them in the grid.
    expect(found?.evidence).toHaveLength(5);
  });

  it('lists every statement, most repeated first, with how often each ran', async () => {
    const { diagnostics } = await diagnose(
      // The first statement runs twice, so it heads the list.
      ...Array.from({ length: 12 }, (_, index) =>
        soql(40, dynamicSoql(index === 11 ? 0 : index), 1),
      ),
    );

    const found = diagnostics.find((d) => d.id.startsWith('row-at-a-time|'));
    expect(found?.count).toBe(12);
    expect(found?.evidence).toHaveLength(11);
    expect(found?.evidence?.[0]).toEqual({
      text: dynamicSoql(0),
      eventId: 1,
      count: 2,
      dialect: 'soql',
    });
    expect(found?.message).toContain('11 statements');
  });

  // A bound variable logs as its name; a query built as a string carries the record's values.
  it.each<[string, (i: number) => number, (i: number) => string, number, string[]]>([
    ['no rows counted: the evidence is absent, not one row', (i) => 40 + i, dynamicSoql, 0, []],
    [
      'one query built per record returning many rows',
      (i) => 10 + i,
      (i) => `SELECT Id FROM Account WHERE Name = 'Acme ${i}'`,
      200,
      [],
    ],
    [
      'a bulkified query',
      () => 42,
      () => 'SELECT Id FROM Account WHERE Id IN :idSet',
      200,
      ['repeat-line'],
    ],
    [
      'one statement from one line',
      () => 42,
      () => 'SELECT Id FROM Account WHERE Id = :id LIMIT 1',
      1,
      ['repeat-line'],
    ],
    [
      'one statement from several lines',
      (i) => 40 + i,
      () => 'SELECT Id FROM Account WHERE Id = :id LIMIT 1',
      1,
      ['repeat-text'],
    ],
    [
      'a loop on one line whose text carries the record values',
      () => 42,
      (i) => dynamicSoql(i, 'Account'),
      1,
      ['row-at-a-time'],
    ],
  ])('raises the right repetition rule for %s', async (_name, line, text, rows, expected) => {
    const { diagnostics } = await diagnose(
      ...Array.from({ length: 6 }, (_, index) => soql(line(index), text(index), rows)),
    );

    const raised = ['repeat-line', 'repeat-text', 'row-at-a-time'].filter((rule) =>
      diagnostics.some((d) => d.id.startsWith(`${rule}|`)),
    );
    expect(raised).toEqual(expected);
  });

  it('counts one line in two classes as two call sites', async () => {
    const text = 'SELECT Id FROM Account WHERE Id = :id LIMIT 1';
    const { diagnostics } = await diagnose(
      at('EXECUTION_STARTED'),
      ...['Class.A.run()', 'Class.B.run()'].flatMap((method) => [
        at(`METHOD_ENTRY|[1]|01p|${method}`),
        ...Array.from({ length: 6 }, () => soql(42, text, 1)),
        at(`METHOD_EXIT|[1]|${method}`),
      ]),
      at('EXECUTION_FINISHED'),
    );

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

  it('runs the SOQL rules once per distinct query and carries the count', async () => {
    const { diagnostics, lintedQueries } = await diagnose(
      ...[1, 2, 3].map((line) => soql(line, 'SELECT Id FROM Account')),
    );

    const unbounded = diagnostics.find((d) => d.summary.startsWith('SOQL is unbounded'));
    expect(unbounded?.count).toBe(3);
    // The rule names a problem; the query it read is what ties it to the grid.
    expect(unbounded?.evidence).toEqual([
      { text: 'SELECT Id FROM Account', eventId: 1, count: 3, dialect: 'soql' },
    ]);
    expect(lintedQueries).toEqual({ linted: 1, distinct: 1 });
  });

  it('lists every query a SOQL rule fired on, most repeated first', async () => {
    // Three queries raise the same rule, each running a different number of times.
    const texts = ['SELECT Id FROM Account', 'SELECT Id FROM Contact', 'SELECT Id FROM Lead'];
    const { diagnostics } = await diagnose(
      ...texts.flatMap((text, index) =>
        Array.from({ length: 3 - index }, (_, run) => soql(index * 3 + run + 1, text)),
      ),
    );

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
    const { diagnostics, queryPlansKnown } = await diagnose(
      at('SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account LIMIT 1'),
      at(
        'SOQL_EXECUTE_EXPLAIN|[2]|TableScan on Account : [], cardinality: 9, sobjectCardinality: 9, relativeCost 2.5',
      ),
      at('SOQL_EXECUTE_END|[2]|Rows:1'),
    );

    expect(queryPlansKnown).toBe(true);
    expect(diagnostics.map((d) => [d.summary, d.meta])).toEqual([
      ['Query is not selective.', 'Account'],
      ['Full table scan.', 'Account'],
    ]);
    expect(diagnostics.map((d) => d.evidence?.map((e) => e.text))).toEqual([
      ['SELECT Id FROM Account LIMIT 1'],
      ['SELECT Id FROM Account LIMIT 1'],
    ]);
    // The query is the row to reveal (id 1), not the plan line under it (id 2).
    expect(diagnostics.map((d) => d.eventId)).toEqual([1, 1]);
  });

  it('says the plans are unknown when the log holds none', async () => {
    const { queryPlansKnown } = await diagnose(soql(2, 'SELECT Id FROM Account LIMIT 1'));
    expect(queryPlansKnown).toBe(false);
  });

  it('heads the findings with a truncated log, ahead of the other issues', async () => {
    // The frame the cut leaves open is the parser's Unexpected-End.
    const { diagnostics } = await diagnose(at('METHOD_ENTRY|[1]|01p|A.run()'), MAX_SIZE);

    expect(diagnostics.map((d) => d.summary)).toEqual(['Log truncated', 'Unexpected-End']);
    expect(diagnostics[0]?.severity).toBe('Warning');
    expect(diagnostics[0]?.meta).toBeUndefined();
    expect(diagnostics[0]?.message).toContain('may be undercounted');
  });

  it('states the size the parser totalled over every skipped region', async () => {
    const { diagnostics } = await diagnose(
      debug(),
      skipped('1,000,000'),
      debug(),
      skipped('2,000,000'),
      debug(),
    );

    expect(diagnostics[0]?.summary).toBe('Log truncated in 2 places');
    expect(diagnostics[0]?.meta).toBe('3 MB');
  });

  it('leads with the truncation caveat, under an error finding that outranks it', async () => {
    const { diagnostics } = await diagnose(at(`FATAL_ERROR|${NPE}`), MAX_SIZE);

    expect(diagnostics.map((d) => [d.summary, d.severity])).toEqual([
      ['Log truncated', 'Warning'],
      [NPE, 'Error'],
    ]);
  });

  it('groups exceptions by their text, counting the throws', async () => {
    const { diagnostics } = await diagnose(
      at(`EXCEPTION_THROWN|[1]|${NPE}`),
      at(`EXCEPTION_THROWN|[2]|${NPE}`),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.count).toBe(2);
    expect(diagnostics[0]?.eventId).toBe(1);
    expect(diagnostics[0]?.evidence).toBeUndefined();
  });

  it('grades a caught exception below one that rolled the transaction back', async () => {
    expect((await diagnose(at(`EXCEPTION_THROWN|[1]|${NPE}`))).diagnostics[0]?.severity).toBe(
      'Warning',
    );
    expect((await diagnose(at(`FATAL_ERROR|${NPE}`))).diagnostics[0]?.severity).toBe('Error');
  });

  it('groups the same exception thrown from different places, and keeps the frame', async () => {
    const { diagnostics } = await diagnose(
      ...['Class.A.run()', 'Class.B.run()'].flatMap((method, index) => [
        at(`METHOD_ENTRY|[1]|01p|${method}`),
        at(`EXCEPTION_THROWN|[${index + 7}]|${NPE}`),
        at(`METHOD_EXIT|[1]|${method}`),
      ]),
      at(`FATAL_ERROR|${NPE}\n\nClass.A.run: line 31, column 1`),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.summary).toBe(NPE);
    expect(diagnostics[0]?.count).toBe(2);
    expect(diagnostics[0]?.evidence?.[0]?.text).toBe('Class.A.run: line 31, column 1');
  });

  it('marks an exception nothing caught', async () => {
    const { diagnostics } = await diagnose(
      at(`EXCEPTION_THROWN|[1]|${NPE}`),
      at(`FATAL_ERROR|${NPE}`),
    );

    expect(diagnostics).toHaveLength(1);
    // One throw, reported once: the fatal error is that same throw escaping.
    expect(diagnostics[0]?.count).toBe(1);
    expect(diagnostics[0]?.meta).toBe('unhandled');
  });

  it('reports a limit exception as the governor breach it is, not as an exception', async () => {
    const message = 'System.LimitException: Apex CPU time limit exceeded';
    const { diagnostics } = await diagnose(
      at(`EXCEPTION_THROWN|[31]|${message}`),
      at(`FATAL_ERROR|${message}\n\nClass.A.run: line 31, column 1`),
      limitUsage({ '(default)': [cpuUsed(15_163)] }),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.summary).toBe('CPU Time limit exceeded');
    expect(diagnostics[0]?.meta).toBe('15,163 ms / 10,000 ms');
    // No method holds the throw, so it points at the throw itself.
    expect(diagnostics[0]?.eventId).toBe(1);
    expect(diagnostics[0]?.evidence?.[0]?.text).toBe('Class.A.run: line 31, column 1');
  });

  it('still reports a limit exception when the log holds no cumulative totals', async () => {
    const { diagnostics } = await diagnose(
      at('EXCEPTION_THROWN|[1]|System.LimitException: Too many SOQL queries: 101'),
    );

    expect(diagnostics.map((d) => [d.summary, d.meta])).toEqual([
      ['SOQL limit exceeded', undefined],
    ]);
  });

  it('names the method most of the self time went into, beside the CPU breach', async () => {
    const { diagnostics } = await diagnose(
      at('METHOD_ENTRY|[1]|01p|Slow.run()'),
      at('METHOD_EXIT|[1]|Slow.run()', 9e9),
      at('METHOD_ENTRY|[1]|01p|Fast.run()', 0),
      at('METHOD_EXIT|[1]|Fast.run()', 1e9),
      limitUsage({ '(default)': [cpuUsed(15_163)] }),
    );

    expect(diagnostics[0]?.cause).toEqual({
      label: 'Most time in',
      name: 'Slow.run()',
      value: '9 s (90%)',
    });
  });

  it('points a breach at the method it stopped in, not at the exception row', async () => {
    const { diagnostics } = await diagnose(
      at('METHOD_ENTRY|[1]|01p|A.run()'),
      at('EXCEPTION_THROWN|[2]|System.LimitException: Apex CPU time limit exceeded'),
      at('METHOD_EXIT|[1]|A.run()'),
    );

    expect(diagnostics[0]?.eventId).toBe(1);
  });

  it('counts debug statements once they are worth reporting', async () => {
    expect((await diagnose(...Array.from({ length: 49 }, debug))).diagnostics).toEqual([]);

    const { diagnostics } = await diagnose(...Array.from({ length: 50 }, debug));
    expect(diagnostics[0]?.summary).toBe('50 debug statements ran');
    expect(diagnostics[0]?.severity).toBe('Info');
  });

  it('orders findings by severity, then by how often they happened', async () => {
    const { diagnostics } = await diagnose(
      ...Array.from({ length: 50 }, debug),
      at('FATAL_ERROR|System.QueryException: List has no rows'),
      limitUsage({ '(default)': [cpuUsed(9_000)] }),
    );

    expect(diagnostics.map((d) => d.severity)).toEqual(['Error', 'Warning', 'Info']);
  });

  it('times a finding where the log times its events, and leaves the rest untimed', async () => {
    const text = 'SELECT Id FROM Account WHERE Id = :id LIMIT 1';
    const { diagnostics, logNs } = await diagnose(
      // Six of 50 ns, from 10 to 360; the last line closes the log at 1,010.
      ...Array.from({ length: 6 }, () => soql(214, text, 0, 50)),
      at('USER_DEBUG|[1]|DEBUG|end', 650),
    );

    expect(logNs).toBe(1_000);
    expect(diagnostics.find((d) => d.id.startsWith('repeat-line|'))?.timeNs).toBe(300);
  });

  it('counts a statement inside another once, so a re-fired trigger is not doubled', async () => {
    // A trigger that inserts again re-fires itself, so the nested DML's 60 ns are
    // already inside the outer one's 100.
    const trigger = 'AccountTrigger on Account trigger event BeforeInsert';
    const { diagnostics } = await diagnose(
      at('DML_BEGIN|[10]|Op:Insert|Type:Account|Rows:1'),
      at(`CODE_UNIT_STARTED|[EXTERNAL]|01q|${trigger}`),
      at('DML_BEGIN|[11]|Op:Insert|Type:Account|Rows:1'),
      at('DML_END|[11]', 60),
      at(`CODE_UNIT_FINISHED|${trigger}`, 5),
      at('DML_END|[10]', 15),
      ...[12, 13, 14].map((line) => dml(line, 100)),
    );

    expect(diagnostics.find((d) => d.id.startsWith('repeat-text|'))?.timeNs).toBe(400);
  });

  it('leaves a debug finding untimed, since the log measures no duration for one', async () => {
    const { diagnostics } = await diagnose(...Array.from({ length: 50 }, debug));
    expect(diagnostics[0]?.timeNs).toBeUndefined();
  });
});

describe('scopeDiagnostics', () => {
  /** Six repeated queries, all called from one method, which is id 1. */
  async function repeatsUnderAMethod() {
    const text = 'SELECT Id FROM Account WHERE Id = :id LIMIT 1';
    const { log, store } = await rawStoreOf(
      at('METHOD_ENTRY|[1]|01p|Slow.run()') +
        Array.from({ length: 6 }, () => soql(214, text)).join('') +
        at('METHOD_EXIT|[1]|Slow.run()'),
    );
    return { log, result: await store.derive(logDiagnostics) };
  }

  // The log figures stay, so a scoped share still reads against the whole log.
  it('keeps a finding whose events are below the selection, and the log figures', async () => {
    const { log, result } = await repeatsUnderAMethod();
    expect(result.diagnostics.length).toBeGreaterThan(0);

    const scoped = scopeDiagnostics(log, result, [1]);
    expect(scoped.diagnostics).toEqual(result.diagnostics);
    expect(scoped.logNs).toBe(result.logNs);
    expect(scoped.lintedQueries).toEqual(result.lintedQueries);
  });

  it.each([
    // An id outside the method: nothing the findings name is inside it.
    ['a selection the findings never reached', [42]],
    ['no occurrences', []],
  ])('scopes to nothing for %s', async (_name, occurrences) => {
    const { log, result } = await repeatsUnderAMethod();

    expect(scopeDiagnostics(log, result, occurrences).diagnostics).toEqual([]);
  });
});

describe('diagnostics of a log filtered by level', () => {
  it('reads past the events the filter hid', async () => {
    const { store } = await storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (2000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
        '09:18:22.6 (3000)|SOQL_EXECUTE_END|[2]|Rows:1\n' +
        '09:18:22.6 (4000)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const filtered = await filterByLevels(store, { apexCode: 'ERROR' });
    if (!filtered || filtered === store) {
      throw new Error('the filter hid nothing');
    }

    await expect(filtered.derive(logDiagnostics)).resolves.toBeDefined();
  });
});
