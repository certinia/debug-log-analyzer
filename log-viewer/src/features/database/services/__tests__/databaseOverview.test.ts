/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { parse } from 'apex-log-parser';

import {
  concentration,
  databaseOverview,
  dmlOperation,
  UNKNOWN_OBJECT,
} from '../databaseOverview.js';

const HEAD =
  '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
  '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n';
const TAIL =
  '09:18:23.6 (1000000000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
  '09:18:23.6 (1000100000)|EXECUTION_FINISHED\n';

const soql = (start: number, end: number, rows: number, query: string, line = 1) =>
  `09:18:22.6 (${start})|SOQL_EXECUTE_BEGIN|[${line}]|Aggregations:0|${query}\n` +
  `09:18:22.6 (${end})|SOQL_EXECUTE_END|[${line}]|Rows:${rows}\n`;

const dml = (start: number, end: number, op: string, type: string, rows: number, line = 2) =>
  `09:18:22.6 (${start})|DML_BEGIN|[${line}]|Op:${op}|Type:${type}|Rows:${rows}\n` +
  `09:18:22.6 (${end})|DML_END|[${line}]\n`;

const sosl = (start: number, end: number, rows: number, line = 3) =>
  `09:18:22.6 (${start})|SOSL_EXECUTE_BEGIN|[${line}]|FIND :term RETURNING Account(Id)\n` +
  `09:18:22.6 (${end})|SOSL_EXECUTE_END|[${line}]|Rows:${rows}\n`;

const overviewOf = (body: string) => databaseOverview(parse(HEAD + body + TAIL));

describe('dmlOperation', () => {
  it('reads the operation out of a DML line', () => {
    expect(dmlOperation('DML Op:Insert Type:Account')).toEqual('Insert');
  });

  it('falls back to DML when the line names no operation', () => {
    expect(dmlOperation('DML')).toEqual('DML');
  });
});

describe('databaseOverview time', () => {
  it('splits database time by statement kind and shares it against the log', () => {
    const overview = overviewOf(
      soql(10_000_000, 30_000_000, 5, 'SELECT Id FROM Account') +
        dml(40_000_000, 50_000_000, 'Insert', 'Contact', 2) +
        sosl(60_000_000, 70_000_000, 3),
    );

    expect(overview.time.soql).toEqual({ timeNs: 20_000_000, statements: 1 });
    expect(overview.time.dml).toEqual({ timeNs: 10_000_000, statements: 1 });
    expect(overview.time.sosl).toEqual({ timeNs: 10_000_000, statements: 1 });
    expect(overview.time.timeNs).toEqual(40_000_000);
    expect(overview.time.percentOfLog).toBeCloseTo(4.0, 1);
    // The log's own duration is the spine's denominator, so it travels with the figures.
    expect(overview.time.logNs).toBeGreaterThan(overview.time.timeNs);
  });

  it('reports zeroes for a log with no statements', () => {
    const overview = overviewOf('');

    expect(overview.time.timeNs).toEqual(0);
    expect(overview.time.percentOfLog).toEqual(0);
    expect(overview.ranked).toEqual([]);
    expect(overview.tree).toEqual([]);
    expect(overview.askedBy).toEqual([]);
    expect(overview.burnedIn).toEqual([]);
  });

  it('computes once per log', () => {
    const apexLog = parse(HEAD + soql(10_000_000, 20_000_000, 1, 'SELECT Id FROM Account') + TAIL);

    expect(databaseOverview(apexLog)).toBe(databaseOverview(apexLog));
  });
});

describe('databaseOverview statements', () => {
  const body =
    soql(10_000_000, 11_000_000, 5, 'SELECT Id FROM Account') +
    soql(12_000_000, 42_000_000, 90, 'SELECT Name FROM Contact') +
    dml(43_000_000, 45_000_000, 'Insert', 'Case', 3);

  it('ranks every statement by its own time, longest first', () => {
    const overview = overviewOf(body);

    expect(overview.ranked).toEqual([
      {
        eventIndex: expect.any(Number),
        eventIndexes: [expect.any(Number)],
        kind: 'SOQL',
        label: 'SELECT Name FROM Contact',
        sObject: 'Contact',
        timeNs: 30_000_000,
        netNs: 30_000_000,
        selfNs: 30_000_000,
        rows: 90,
        maxRows: 90,
        repeats: 1,
      },
      {
        eventIndex: expect.any(Number),
        eventIndexes: [expect.any(Number)],
        kind: 'DML',
        label: 'Insert Case',
        sObject: 'Case',
        timeNs: 2_000_000,
        netNs: 2_000_000,
        selfNs: 2_000_000,
        rows: 3,
        maxRows: 3,
        repeats: 1,
      },
      {
        eventIndex: expect.any(Number),
        eventIndexes: [expect.any(Number)],
        kind: 'SOQL',
        label: 'SELECT Id FROM Account',
        sObject: 'Account',
        timeNs: 1_000_000,
        netNs: 1_000_000,
        selfNs: 1_000_000,
        rows: 5,
        maxRows: 5,
        repeats: 1,
      },
    ]);
  });

  it('sums every occurrence of the same statement into one row', () => {
    const overview = overviewOf(
      soql(10_000_000, 12_000_000, 3, 'SELECT Id FROM Account') +
        soql(13_000_000, 15_000_000, 2, 'SELECT Id FROM Account', 4) +
        dml(16_000_000, 19_000_000, 'Insert', 'Case', 1),
    );

    expect(
      overview.ranked.map((statement) => [statement.label, statement.repeats, statement.timeNs]),
    ).toEqual([
      ['SELECT Id FROM Account', 2, 4_000_000],
      ['Insert Case', 1, 3_000_000],
    ]);
    // The rows of every occurrence, the most one of them read, and the slowest
    // one to reveal.
    expect(overview.ranked[0]).toMatchObject({
      rows: 5,
      maxRows: 3,
      eventIndexes: [expect.any(Number), expect.any(Number)],
    });
  });

  it('names the SObject each statement touched, and none for a search', () => {
    const overview = overviewOf(
      soql(10_000_000, 12_000_000, 3, 'SELECT Id FROM Account') +
        dml(13_000_000, 15_000_000, 'Insert', 'Case', 1) +
        sosl(16_000_000, 19_000_000, 2),
    );

    expect(overview.ranked.map((statement) => [statement.kind, statement.sObject])).toEqual([
      ['SOSL', null],
      ['DML', 'Case'],
      ['SOQL', 'Account'],
    ]);
  });

  it('gives every statement its own event index, so a row can be revealed', () => {
    const indexes = overviewOf(body).ranked.map((statement) => statement.eventIndex);

    expect(new Set(indexes).size).toEqual(indexes.length);
  });

  it('labels DML the log gives no SObject for', () => {
    const overview = overviewOf(
      '09:18:22.6 (10000000)|DML_BEGIN|[2]|Op:Insert|Rows:1\n' +
        '09:18:22.6 (11000000)|DML_END|[2]\n',
    );

    expect(overview.ranked[0]?.label).toEqual(`Insert ${UNKNOWN_OBJECT}`);
  });
});

describe('databaseOverview tree', () => {
  const method = (start: number, end: number, name: string, body: string, line = 5) =>
    `09:18:22.6 (${start})|METHOD_ENTRY|[${line}]|01p|${name}\n` +
    body +
    `09:18:22.6 (${end})|METHOD_EXIT|[${line}]|01p|${name}\n`;

  it('keeps only the paths that end in a statement, each carrying its time', () => {
    const overview = overviewOf(
      method(
        9_000_000,
        45_000_000,
        'Svc.load()',
        soql(10_000_000, 40_000_000, 90, 'SELECT Name FROM Contact'),
      ) + method(46_000_000, 47_000_000, 'Svc.idle()', ''),
    );

    // The execution marker names no code, so the path starts at the code unit.
    const entry = overview.tree[0];
    expect(entry).toMatchObject({ label: 'apex://pkg.Entry', kind: null, timeNs: 30_000_000 });
    expect(entry?.children.map((node) => node.label)).toEqual(['Svc.load()']);
    expect(entry?.children[0]?.children[0]).toMatchObject({
      label: 'SELECT Name FROM Contact',
      kind: 'SOQL',
      timeNs: 30_000_000,
      count: 1,
    });
  });

  it('merges repeated frames into one node with a count and every occurrence', () => {
    const call = (start: number, end: number, line: number) =>
      method(
        start,
        end,
        'Svc.load()',
        soql(start + 100_000, end - 100_000, 1, 'SELECT Id FROM Account', line),
      );
    const overview = overviewOf(call(10_000_000, 20_000_000, 1) + call(21_000_000, 31_000_000, 2));

    const frame = overview.tree[0]?.children[0];
    expect(frame).toMatchObject({ label: 'Svc.load()', count: 2, timeNs: 19_600_000 });
    expect(frame?.children[0]).toMatchObject({ kind: 'SOQL', count: 2 });
    expect(frame?.children[0]?.eventIndexes).toHaveLength(2);
  });

  it('sorts each level longest first', () => {
    const overview = overviewOf(
      method(9_000_000, 12_000_000, 'Svc.fast()', soql(10_000_000, 11_000_000, 1, 'SELECT Id A')) +
        method(
          13_000_000,
          45_000_000,
          'Svc.slow()',
          soql(14_000_000, 44_000_000, 1, 'SELECT Id B'),
        ),
    );

    expect(overview.tree[0]?.children.map((node) => node.label)).toEqual([
      'Svc.slow()',
      'Svc.fast()',
    ]);
  });

  it('splits a statement duration into its own time and its descendants', () => {
    const overview = overviewOf(
      '09:18:22.6 (10000000)|DML_BEGIN|[2]|Op:Insert|Type:Case|Rows:3\n' +
        '09:18:22.6 (11000000)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000001|CaseTrigger\n' +
        soql(12_000_000, 13_000_000, 1, 'SELECT Id FROM Account', 9) +
        '09:18:22.6 (18000000)|CODE_UNIT_FINISHED|CaseTrigger\n' +
        '09:18:22.6 (20000000)|DML_END|[2]\n',
    );
    const insert = overview.ranked.find((statement) => statement.kind === 'DML');

    // 10ms in all: 3ms the insert's own, 7ms in the trigger it fired, and 1ms of
    // that trigger time is the query — the only part the database did.
    expect(insert).toMatchObject({ timeNs: 10_000_000, netNs: 9_000_000, selfNs: 3_000_000 });
  });

  it('nests a statement inside the statement that holds it, on a total/self split', () => {
    const overview = overviewOf(
      '09:18:22.6 (10000000)|DML_BEGIN|[2]|Op:Insert|Type:Case|Rows:3\n' +
        soql(11_000_000, 12_000_000, 1, 'SELECT Id FROM Account', 9) +
        '09:18:22.6 (13000000)|DML_END|[2]\n',
    );

    // The query owns its own time; the DML's total holds it, its net time does not.
    expect(overview.time.soql).toEqual({ timeNs: 1_000_000, statements: 1 });
    expect(overview.time.dml).toEqual({ timeNs: 2_000_000, statements: 1 });
    expect(overview.time.timeNs).toEqual(3_000_000);
    expect(
      overview.ranked.map((statement) => [statement.kind, statement.timeNs, statement.netNs]),
    ).toEqual([
      ['DML', 3_000_000, 2_000_000],
      ['SOQL', 1_000_000, 1_000_000],
    ]);

    const dmlNode = overview.tree[0]?.children[0];
    expect(dmlNode).toMatchObject({ kind: 'DML', timeNs: 3_000_000, selfNs: 2_000_000 });
    // The query is the DML's child, and takes no time up the path: the DML's
    // total already holds it, so nothing is counted twice.
    expect(dmlNode?.children[0]).toMatchObject({
      kind: 'SOQL',
      timeNs: 1_000_000,
      selfNs: 1_000_000,
    });
    // A frame's total is the database time beneath it; its self is its own code,
    // every child excluded, so the two never overlap.
    expect(overview.tree[0]).toMatchObject({ timeNs: 3_000_000 });
    expect(overview.tree[0]?.selfNs).toBeGreaterThan(3_000_000);
  });

  it('takes a frame own code from the frame, counted once per occurrence', () => {
    const overview = overviewOf(
      method(
        10_000_000,
        20_000_000,
        'Svc.load()',
        soql(11_000_000, 12_000_000, 1, 'SELECT Id FROM Account') +
          dml(13_000_000, 15_000_000, 'Insert', 'Case', 1),
      ),
    );

    // 10ms of frame less the 1ms query and the 2ms DML: the Apex around them,
    // added once though two statement paths reach the frame.
    expect(overview.tree[0]?.children[0]).toMatchObject({
      label: 'Svc.load()',
      timeNs: 3_000_000,
      selfNs: 7_000_000,
    });
  });

  it('nets every nested statement off the one that holds them, and adds up', () => {
    const overview = overviewOf(
      '09:18:22.6 (10000000)|DML_BEGIN|[2]|Op:Insert|Type:Case|Rows:3\n' +
        soql(11_000_000, 13_000_000, 1, 'SELECT Id FROM Account', 9) +
        soql(14_000_000, 17_000_000, 1, 'SELECT Id FROM Contact', 10) +
        '09:18:22.6 (20000000)|DML_END|[2]\n',
    );

    expect(overview.ranked.map((statement) => statement.netNs)).toEqual([
      5_000_000, // the DML's 10ms less the 5ms in its two queries
      3_000_000,
      2_000_000,
    ]);
    // Net times still sum to the database total.
    expect(overview.time.timeNs).toEqual(10_000_000);
  });
});

describe('concentration', () => {
  it('counts the statements it takes to cross the target share', () => {
    const overview = overviewOf(
      soql(10_000_000, 40_000_000, 1, 'SELECT Id FROM Account') +
        soql(41_000_000, 46_000_000, 1, 'SELECT Id FROM Contact') +
        dml(47_000_000, 52_000_000, 'Insert', 'Case', 1),
    );

    expect(concentration(overview)).toEqual({ count: 1, percent: 75 });
  });

  it('walks on when no single statement dominates', () => {
    const overview = overviewOf(
      soql(10_000_000, 20_000_000, 1, 'SELECT Id FROM Account') +
        soql(21_000_000, 31_000_000, 1, 'SELECT Id FROM Contact'),
    );

    expect(concentration(overview)).toEqual({ count: 2, percent: 100 });
  });

  it('takes a target of its own', () => {
    const overview = overviewOf(
      soql(10_000_000, 20_000_000, 1, 'SELECT Id FROM Account') +
        soql(21_000_000, 31_000_000, 1, 'SELECT Id FROM Contact'),
    );

    expect(concentration(overview, 50)).toMatchObject({ count: 1, percent: 50 });
  });

  it('reports nothing held for a log with no statements', () => {
    expect(concentration(overviewOf(''))).toEqual({ count: 0, percent: 0 });
  });
});

describe('databaseOverview namespaces', () => {
  it('charges every kind to the namespace of the code that ran it', () => {
    const overview = overviewOf(
      soql(10_000_000, 30_000_000, 5, 'SELECT Id FROM Account') +
        dml(31_000_000, 41_000_000, 'Insert', 'Account', 8),
    );

    expect(overview.askedBy).toEqual([
      {
        key: 'pkg',
        timeNs: 30_000_000,
        soqlTimeNs: 20_000_000,
        dmlTimeNs: 10_000_000,
        soslTimeNs: 0,
        statements: 2,
        rowsRead: 5,
        rowsWritten: 8,
      },
    ]);
    // Nothing runs inside these statements, so both questions have one answer.
    expect(overview.burnedIn).toEqual(overview.askedBy);
  });

  it('counts a search as rows read for its caller namespace', () => {
    const overview = overviewOf(sosl(10_000_000, 11_000_000, 7));

    expect(overview.askedBy[0]).toMatchObject({
      key: 'pkg',
      soslTimeNs: 1_000_000,
      rowsRead: 7,
    });
  });

  it('ranks namespaces by their database time', () => {
    const overview = overviewOf(
      soql(10_000_000, 12_000_000, 1, 'SELECT Id FROM Account') +
        '09:18:22.6 (13000000)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ik|apex://other.Entry\n' +
        soql(14_000_000, 44_000_000, 1, 'SELECT Id FROM Contact') +
        '09:18:22.6 (45000000)|CODE_UNIT_FINISHED|apex://other.Entry\n',
    );

    expect(overview.askedBy.map((entry) => entry.key)).toEqual(['other', 'pkg']);
  });

  it('charges the code beneath a DML to its own namespace', () => {
    // A trigger from another package fires on the caller's insert.
    const overview = overviewOf(
      '09:18:22.6 (10000000)|DML_BEGIN|[2]|Op:Insert|Type:Case|Rows:1\n' +
        '09:18:22.6 (11000000)|CODE_UNIT_STARTED|[EXTERNAL]|01q|trig.CaseTrigger on Case trigger event BeforeInsert|__sfdc_trigger/trig/CaseTrigger\n' +
        '09:18:22.6 (17000000)|CODE_UNIT_FINISHED|trig.CaseTrigger on Case trigger event BeforeInsert\n' +
        '09:18:22.6 (20000000)|DML_END|[2]\n',
    );

    // Who asked: all 10ms against the caller.
    expect(overview.askedBy.map((entry) => [entry.key, entry.timeNs])).toEqual([
      ['pkg', 10_000_000],
    ]);
    // Where it went: 6ms in the trigger's package, the platform's own 4ms with
    // the caller that asked for the save.
    expect(overview.burnedIn.map((entry) => [entry.key, entry.timeNs])).toEqual([
      ['trig', 6_000_000],
      ['pkg', 4_000_000],
    ]);
    // The rows stay with the statement, so they follow the caller.
    expect(overview.burnedIn[1]).toMatchObject({ statements: 1, rowsWritten: 1 });
  });
});
