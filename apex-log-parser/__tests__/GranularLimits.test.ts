/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { parse } from '../src/index.js';
import type { HeapAllocateLine, LimitUsageLine, LogEvent } from '../src/index.js';

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
  '  Number of SOQL queries: 8 out of 100\n' +
  '  Number of query rows: 26 out of 50000\n' +
  '  Number of SOSL queries: 0 out of 20\n' +
  '  Number of DML statements: 3 out of 150\n' +
  '  Number of Publish Immediate DML: 0 out of 150\n' +
  '  Number of DML rows: 12 out of 10000\n' +
  '  Maximum CPU time: 4564 out of 10000\n' +
  '  Maximum heap size: 1234 out of 6000000\n' + // format matches real logs (no thousands separators)
  '  Number of callouts: 0 out of 100\n' +
  '  Number of Email Invocations: 0 out of 10\n' +
  '  Number of future calls: 0 out of 50\n' +
  '  Number of queueable jobs added to the queue: 0 out of 50\n' +
  '  Number of Mobile Apex push calls: 0 out of 10\n' +
  '09:18:22.6 (500)|CUMULATIVE_LIMIT_USAGE_END\n';

describe('granular limit parsing (via parse)', () => {
  const log =
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:18:22.6 (200)|HEAP_ALLOCATE|[84]|Bytes:152\n' +
    '09:18:22.6 (250)|HEAP_ALLOCATE|[EXTERNAL]|Bytes:-4\n' +
    '09:18:22.6 (300)|LIMIT_USAGE|[89]|SOQL|1|100\n' +
    '09:18:22.6 (350)|LIMIT_USAGE|[89]|FIELDS_DESCRIBES|1|100\n' +
    '09:18:22.6 (400)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 SOQL queries, total 5 out of 100\n' +
    '09:18:22.6 (420)|FLOW_ELEMENT_LIMIT_USAGE|2 ms CPU time, total 10 out of 15000\n' +
    '09:18:22.6 (450)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|DML statements: 3 out of 150\n' +
    CUMULATIVE_BLOCK +
    '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';
  const apexLog = parse(log);
  const events = flatten(apexLog);
  const byType = (type: string): LimitUsageLine[] =>
    events.filter((e) => e.type === type) as LimitUsageLine[];

  it('parses heap allocation bytes, including negatives', () => {
    const heap = events.filter((e) => e.type === 'HEAP_ALLOCATE') as HeapAllocateLine[];
    expect(heap.map((h) => h.bytes)).toEqual([152, -4]);
  });

  it('parses governor LIMIT_USAGE records and ignores non-governor codes', () => {
    const [soql, describes] = byType('LIMIT_USAGE');
    expect(soql?.limitUsage).toEqual({ metric: 'soqlQueries', used: 1, limit: 100 });
    expect(describes?.limitUsage).toBeNull();
  });

  it('parses flow running-total reports (uses the total as used)', () => {
    expect(byType('FLOW_BULK_ELEMENT_LIMIT_USAGE')[0]?.limitUsage).toEqual({
      metric: 'soqlQueries',
      used: 5,
      limit: 100,
    });
    expect(byType('FLOW_ELEMENT_LIMIT_USAGE')[0]?.limitUsage).toEqual({
      metric: 'cpuTime',
      used: 10,
      limit: 15000,
    });
  });

  it('parses flow colon reports', () => {
    expect(byType('FLOW_INTERVIEW_FINISHED_LIMIT_USAGE')[0]?.limitUsage).toEqual({
      metric: 'dmlStatements',
      used: 3,
      limit: 150,
    });
  });

  it('parses the whole cumulative LIMIT_USAGE_FOR_NS block (shared parser)', () => {
    const snapshot = apexLog.governorLimits.snapshots.at(-1);
    expect(snapshot?.namespace).toBe('default');
    expect(snapshot?.limits.soqlQueries).toEqual({ used: 8, limit: 100 });
    expect(snapshot?.limits.cpuTime).toEqual({ used: 4564, limit: 10000 });
    expect(snapshot?.limits.heapSize).toEqual({ used: 1234, limit: 6000000 });
    expect(snapshot?.limits.dmlRows).toEqual({ used: 12, limit: 10000 });
    expect(snapshot?.limits.mobileApexPushCalls).toEqual({ used: 0, limit: 10 });
  });
});
