/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { parse } from '../src/index.js';
import type { LogEvent } from '../src/index.js';

/** Depth-first flatten of the parsed tree into a flat event list. */
function flatten(root: LogEvent): LogEvent[] {
  const out: LogEvent[] = [];
  const walk = (event: LogEvent): void => {
    out.push(event);
    for (const child of event.children ?? []) {
      walk(child);
    }
  };
  for (const child of root.children ?? []) {
    walk(child);
  }
  return out;
}

const CUMULATIVE_BLOCK =
  '09:18:22.6 (500)|CUMULATIVE_LIMIT_USAGE\n' +
  '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
  '  Number of SOQL queries: 1 out of 100\n' +
  '  Number of query rows: 1 out of 50000\n' +
  '  Number of SOSL queries: 0 out of 20\n' +
  '  Number of DML statements: 1 out of 150\n' +
  '  Number of Publish Immediate DML: 0 out of 150\n' +
  '  Number of DML rows: 1 out of 10000\n' +
  '  Maximum CPU time: 100 out of 10000\n' +
  '  Maximum heap size: 100 out of 6000000\n' +
  '  Number of callouts: 0 out of 100\n' +
  '  Number of Email Invocations: 0 out of 10\n' +
  '  Number of future calls: 0 out of 50\n' +
  '  Number of queueable jobs added to the queue: 0 out of 50\n' +
  '  Number of Mobile Apex push calls: 0 out of 10\n' +
  '09:18:22.6 (500)|CUMULATIVE_LIMIT_USAGE_END\n';

describe('flow database attribution (via parse)', () => {
  it('seeds the bulk element self counters from FLOW_BULK_ELEMENT_LIMIT_USAGE deltas and rolls up to ancestor totals', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|FLOW_BULK_ELEMENT_BEGIN|FlowRecordUpdate|Update_Account\n' +
      '09:18:22.6 (210)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 SOQL queries, total 1 out of 100\n' +
      '09:18:22.6 (220)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 SOQL query rows, total 1 out of 50000\n' +
      '09:18:22.6 (230)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 DML statements, total 1 out of 150\n' +
      '09:18:22.6 (240)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 DML rows, total 1 out of 10000\n' +
      '09:18:22.6 (250)|FLOW_BULK_ELEMENT_LIMIT_USAGE|75 ms CPU time, total 75 out of 15000\n' +
      '09:18:22.6 (260)|FLOW_BULK_ELEMENT_END|FlowRecordUpdate|Update_Account|1|60\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';
    const apexLog = parse(log);
    const events = flatten(apexLog);
    const bulkElement = events.find((e) => e.type === 'FLOW_BULK_ELEMENT_BEGIN');

    expect(bulkElement?.soqlCount.self).toBe(1);
    expect(bulkElement?.soqlRowCount.self).toBe(1);
    expect(bulkElement?.dmlCount.self).toBe(1);
    expect(bulkElement?.dmlRowCount.self).toBe(1);
    // CPU time is not a DB metric - it must not be attributed to dmlCount/soqlCount etc.
    expect(bulkElement?.soslCount.self).toBe(0);

    // Rolls up to the root (ApexLog) totals.
    expect(apexLog.soqlCount.total).toBe(1);
    expect(apexLog.soqlRowCount.total).toBe(1);
    expect(apexLog.dmlCount.total).toBe(1);
    expect(apexLog.dmlRowCount.total).toBe(1);
  });

  it('seeds the (non-bulk) element self counters from FLOW_ELEMENT_LIMIT_USAGE deltas', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|FLOW_ELEMENT_BEGIN|abc-1|FlowRecordUpdate|Update_Account\n' +
      '09:18:22.6 (210)|FLOW_ELEMENT_LIMIT_USAGE|1 DML statements, total 1 out of 150\n' +
      '09:18:22.6 (220)|FLOW_ELEMENT_LIMIT_USAGE|1 DML rows, total 1 out of 10000\n' +
      '09:18:22.6 (230)|FLOW_ELEMENT_END|abc-1|FlowRecordUpdate|Update_Account\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';
    const apexLog = parse(log);
    const events = flatten(apexLog);
    const element = events.find((e) => e.type === 'FLOW_ELEMENT_BEGIN');

    expect(element?.dmlCount.self).toBe(1);
    expect(element?.dmlRowCount.self).toBe(1);
    expect(apexLog.dmlCount.total).toBe(1);
  });

  it('attributes the leading delta, not the running total, when a later element reports a higher total', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|FLOW_BULK_ELEMENT_BEGIN|FlowRecordUpdate|myRule_1_A1\n' +
      '09:18:22.6 (210)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 DML statements, total 2 out of 150\n' +
      '09:18:22.6 (220)|FLOW_BULK_ELEMENT_END|FlowRecordUpdate|myRule_1_A1|1|102\n' +
      '09:18:22.6 (300)|FLOW_BULK_ELEMENT_BEGIN|FlowRecordUpdate|account_update_luke\n' +
      '09:18:22.6 (310)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 DML statements, total 3 out of 150\n' +
      '09:18:22.6 (320)|FLOW_BULK_ELEMENT_END|FlowRecordUpdate|account_update_luke|1|18\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';
    const apexLog = parse(log);
    const elements = flatten(apexLog).filter((e) => e.type === 'FLOW_BULK_ELEMENT_BEGIN');

    expect(elements.map((e) => e.dmlCount.self)).toEqual([1, 1]);
    expect(apexLog.dmlCount.total).toBe(2);
  });

  it('reconciles bulk element deltas against the CUMULATIVE_LIMIT_USAGE snapshot', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|FLOW_BULK_ELEMENT_BEGIN|FlowRecordUpdate|Update_Account\n' +
      '09:18:22.6 (210)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 SOQL queries, total 1 out of 100\n' +
      '09:18:22.6 (220)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 SOQL query rows, total 1 out of 50000\n' +
      '09:18:22.6 (230)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 DML statements, total 1 out of 150\n' +
      '09:18:22.6 (240)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 DML rows, total 1 out of 10000\n' +
      '09:18:22.6 (260)|FLOW_BULK_ELEMENT_END|FlowRecordUpdate|Update_Account|1|60\n' +
      CUMULATIVE_BLOCK +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';
    const apexLog = parse(log);
    const snapshot = apexLog.governorLimits.snapshots.at(-1);

    expect(apexLog.soqlCount.total).toBe(snapshot?.limits.soqlQueries.used);
    expect(apexLog.soqlRowCount.total).toBe(snapshot?.limits.queryRows.used);
    expect(apexLog.dmlCount.total).toBe(snapshot?.limits.dmlStatements.used);
    expect(apexLog.dmlRowCount.total).toBe(snapshot?.limits.dmlRows.used);
  });

  it('attributes only the residual when the element subtree logged its own statements', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|FLOW_ELEMENT_BEGIN|abc-1|FlowActionCall|Call_Apex\n' +
      '09:18:22.6 (205)|CODE_UNIT_STARTED|[EXTERNAL]|01p|MyAction.invoke\n' +
      '09:18:22.6 (206)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account\n' +
      '09:18:22.6 (207)|SOQL_EXECUTE_END|[3]|Rows:1\n' +
      '09:18:22.6 (208)|CODE_UNIT_FINISHED|MyAction.invoke\n' +
      '09:18:22.6 (210)|FLOW_ELEMENT_LIMIT_USAGE|2 SOQL queries, total 2 out of 100\n' +
      '09:18:22.6 (230)|FLOW_ELEMENT_END|abc-1|FlowActionCall|Call_Apex\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';
    const apexLog = parse(log);
    const element = flatten(apexLog).find((e) => e.type === 'FLOW_ELEMENT_BEGIN');

    // The reported 2 covers the 1 query the subtree logged, so only 1 is attributed.
    expect(element?.soqlCount.self).toBe(1);
    expect(element?.soqlCount.total).toBe(2);
    expect(apexLog.soqlCount.total).toBe(2);
  });

  it('attributes nothing when the element subtree already logged the whole reported count', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|FLOW_ELEMENT_BEGIN|abc-1|FlowActionCall|Call_Apex\n' +
      '09:18:22.6 (205)|CODE_UNIT_STARTED|[EXTERNAL]|01p|MyAction.invoke\n' +
      '09:18:22.6 (206)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account\n' +
      '09:18:22.6 (207)|SOQL_EXECUTE_END|[3]|Rows:1\n' +
      '09:18:22.6 (208)|CODE_UNIT_FINISHED|MyAction.invoke\n' +
      '09:18:22.6 (210)|FLOW_ELEMENT_LIMIT_USAGE|1 SOQL queries, total 1 out of 100\n' +
      '09:18:22.6 (230)|FLOW_ELEMENT_END|abc-1|FlowActionCall|Call_Apex\n' +
      CUMULATIVE_BLOCK +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';
    const apexLog = parse(log);
    const element = flatten(apexLog).find((e) => e.type === 'FLOW_ELEMENT_BEGIN');
    const snapshot = apexLog.governorLimits.snapshots.at(-1);

    expect(element?.soqlCount.self).toBe(0);
    expect(apexLog.soqlCount.total).toBe(snapshot?.limits.soqlQueries.used);
  });

  it('attributes a nested element residual to the enclosing element before it is measured', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|FLOW_ELEMENT_BEGIN|abc-1|FlowSubflow|Call_Subflow\n' +
      '09:18:22.6 (205)|FLOW_ELEMENT_BEGIN|abc-2|FlowRecordUpdate|Update_Account\n' +
      '09:18:22.6 (206)|FLOW_ELEMENT_LIMIT_USAGE|1 DML statements, total 1 out of 150\n' +
      '09:18:22.6 (207)|FLOW_ELEMENT_END|abc-2|FlowRecordUpdate|Update_Account\n' +
      '09:18:22.6 (210)|FLOW_ELEMENT_LIMIT_USAGE|1 DML statements, total 1 out of 150\n' +
      '09:18:22.6 (230)|FLOW_ELEMENT_END|abc-1|FlowSubflow|Call_Subflow\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';
    const apexLog = parse(log);
    const [outer, inner] = flatten(apexLog).filter((e) => e.type === 'FLOW_ELEMENT_BEGIN');

    // The subflow reports the same statement its child reported, so it is counted once.
    expect(inner?.dmlCount.self).toBe(1);
    expect(outer?.dmlCount.self).toBe(0);
    expect(outer?.dmlCount.total).toBe(1);
    expect(apexLog.dmlCount.total).toBe(1);
  });

  it('attributes the usage of a flow element the log truncated before its END line', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|FLOW_BULK_ELEMENT_BEGIN|FlowRecordUpdate|Update_Account\n' +
      '09:18:22.6 (210)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 DML statements, total 1 out of 150\n';
    const apexLog = parse(log);
    const bulkElement = flatten(apexLog).find((e) => e.type === 'FLOW_BULK_ELEMENT_BEGIN');

    expect(bulkElement?.dmlCount.self).toBe(1);
    expect(apexLog.dmlCount.total).toBe(1);
  });

  it('does not crash and does not fabricate counts at FINE level (no _LIMIT_USAGE lines emitted)', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|FLOW_BULK_ELEMENT_BEGIN|FlowRecordUpdate|Update_Account\n' +
      '09:18:22.6 (260)|FLOW_BULK_ELEMENT_END|FlowRecordUpdate|Update_Account|1|60\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    expect(() => parse(log)).not.toThrow();

    const apexLog = parse(log);
    const events = flatten(apexLog);
    const bulkElement = events.find((e) => e.type === 'FLOW_BULK_ELEMENT_BEGIN');

    expect(bulkElement?.soqlCount.self).toBe(0);
    expect(bulkElement?.dmlCount.self).toBe(0);
    expect(apexLog.dmlCount.total).toBe(0);
  });
});
