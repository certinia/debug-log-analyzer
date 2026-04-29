import type { LogEvent } from 'apex-log-parser';

import { group } from '../RowGrouper.js';

type EventOptions = {
  text: string;
  self: number;
  total: number;
  parent?: LogEvent | null;
  type?: string;
  namespace?: string;
  dmlSelf?: number;
  dmlTotal?: number;
  soqlSelf?: number;
  soqlTotal?: number;
  thrown?: number;
};

let nextTimestamp = 1;

function createEvent(options: EventOptions): LogEvent {
  const event = {
    logParser: null,
    parent: options.parent ?? null,
    children: [],
    type: (options.type ?? 'METHOD_ENTRY') as LogEvent['type'],
    logLine: '',
    text: options.text,
    acceptsText: false,
    isExit: false,
    isParent: false,
    isTruncated: false,
    nextLineIsExit: false,
    lineNumber: null,
    namespace: options.namespace ?? 'default',
    hasValidSymbols: true,
    suffix: null,
    discontinuity: false,
    timestamp: nextTimestamp++,
    exitStamp: null,
    category: '',
    debugCategory: '',
    debugLevel: '',
    cpuType: '',
    duration: { self: options.self, total: options.total },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    soslRowCount: { self: 0, total: 0 },
    dmlCount: { self: options.dmlSelf ?? 0, total: options.dmlTotal ?? 0 },
    soqlCount: { self: options.soqlSelf ?? 0, total: options.soqlTotal ?? 0 },
    soslCount: { self: 0, total: 0 },
    totalThrownCount: options.thrown ?? 0,
    exitTypes: [],
  } as unknown as LogEvent;

  if (options.parent) {
    options.parent.children.push(event);
  }

  return event;
}

describe('RowGrouper.group', () => {
  beforeEach(() => {
    nextTimestamp = 1;
  });

  it('includes zero-time leaves so DML/SOQL/exception counts and call counts roll up', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    createEvent({
      text: 'LimitOnly',
      self: 0,
      total: 0,
      parent: root,
      dmlSelf: 1,
      dmlTotal: 1,
      thrown: 1,
    });

    const metrics = group(root);
    const limitOnly = metrics.find((m) => m.name === 'LimitOnly');
    if (!limitOnly) throw new Error('LimitOnly metric missing');
    expect(limitOnly.count).toBe(1);
    expect(limitOnly.totalTime).toBe(0);
    expect(limitOnly.selfTime).toBe(0);
    expect(limitOnly.nodes).toHaveLength(1);
  });

  it('keeps different entry types as separate metrics for the same name+namespace', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    createEvent({ text: 'foo', self: 5, total: 5, parent: root, type: 'CODE_UNIT_STARTED' });
    createEvent({ text: 'foo', self: 7, total: 7, parent: root, type: 'METHOD_ENTRY' });

    const metrics = group(root);
    const fooMetrics = metrics.filter((m) => m.name === 'foo');
    expect(fooMetrics).toHaveLength(2);
    const codeUnit = fooMetrics.find((m) => m.type === 'CODE_UNIT_STARTED');
    const methodEntry = fooMetrics.find((m) => m.type === 'METHOD_ENTRY');
    expect(codeUnit?.selfTime).toBe(5);
    expect(methodEntry?.selfTime).toBe(7);
  });

  it('does not double-count totalTime across same-name recursion regardless of entry type', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    // CODE_UNIT_STARTED foo (total=100) → METHOD_ENTRY foo (total=80) → METHOD_ENTRY foo (total=50).
    // The two METHOD_ENTRY recursive calls are nested inside CODE_UNIT_STARTED foo. Recursion
    // detection is type-less, so the inner totalTimes must NOT be added to the METHOD_ENTRY bucket.
    const outer = createEvent({
      text: 'foo',
      self: 20,
      total: 100,
      parent: root,
      type: 'CODE_UNIT_STARTED',
    });
    const inner = createEvent({ text: 'foo', self: 30, total: 80, parent: outer });
    createEvent({ text: 'foo', self: 50, total: 50, parent: inner });

    const metrics = group(root);
    const fooMetrics = metrics.filter((m) => m.name === 'foo');
    expect(fooMetrics).toHaveLength(2);
    const codeUnit = fooMetrics.find((m) => m.type === 'CODE_UNIT_STARTED');
    const methodEntry = fooMetrics.find((m) => m.type === 'METHOD_ENTRY');
    if (!codeUnit || !methodEntry) throw new Error('Missing metric');

    // CODE_UNIT outer is the outermost — gets total=100. The inner METHOD_ENTRY frames are on
    // the call stack via the type-less stack key, so neither contributes total to the
    // METHOD_ENTRY bucket.
    expect(codeUnit.totalTime).toBe(100);
    expect(methodEntry.totalTime).toBe(0);

    // selfTime accumulates regardless of recursion.
    expect(codeUnit.selfTime).toBe(20);
    expect(methodEntry.selfTime).toBe(80);
  });

  it('separates metrics by namespace even when name and type match', () => {
    const root = createEvent({ text: 'LOG_ROOT', self: 0, total: 0, type: 'EXECUTION_STARTED' });
    createEvent({ text: 'doWork', self: 10, total: 10, parent: root, namespace: 'default' });
    createEvent({ text: 'doWork', self: 15, total: 15, parent: root, namespace: 'pkg' });

    const metrics = group(root);
    const namespaces = metrics
      .filter((m) => m.name === 'doWork')
      .map((m) => m.namespace)
      .sort();
    expect(namespaces).toEqual(['default', 'pkg']);
  });
});
