import type { LogEvent } from 'apex-log-parser';

import { sumDurationTotalForRootEvents, sumRootNodesOnly } from '../CallStackSum.js';
import type { Metric } from '../RowGrouper.js';

type EventOptions = {
  text: string;
  total: number;
  parent?: LogEvent | null;
};

let nextTimestamp = 1;

function createEvent(options: EventOptions): LogEvent {
  const event = {
    parent: options.parent ?? null,
    children: [],
    type: 'METHOD_ENTRY' as LogEvent['type'],
    text: options.text,
    namespace: 'default',
    timestamp: nextTimestamp++,
    duration: { self: 0, total: options.total },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    soslRowCount: { self: 0, total: 0 },
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    soslCount: { self: 0, total: 0 },
    totalThrownCount: 0,
  } as unknown as LogEvent;

  if (options.parent) {
    options.parent.children.push(event);
  }

  return event;
}

describe('sumDurationTotalForRootEvents', () => {
  beforeEach(() => {
    nextTimestamp = 1;
  });

  it('counts each call-stack root once and skips events whose ancestors are visible', () => {
    // ParentA(80) → LeafA(80); ParentB(30) → LeafB(30).
    // Naive sum = 80+30+80+30 = 220 (double-counts).
    // Root-only sum picks ParentA and ParentB; leaves are excluded because their parents
    // are in the visible set.
    const parentA = createEvent({ text: 'ParentA', total: 80 });
    const leafA = createEvent({ text: 'Leaf', total: 80, parent: parentA });
    const parentB = createEvent({ text: 'ParentB', total: 30 });
    const leafB = createEvent({ text: 'Leaf', total: 30, parent: parentB });

    expect(sumDurationTotalForRootEvents([[parentA], [parentB], [leafA, leafB]])).toBe(110);
  });

  it('sums every event when none share an ancestor in the visible set', () => {
    const a = createEvent({ text: 'Top1', total: 50 });
    const b = createEvent({ text: 'Top2', total: 70 });
    expect(sumDurationTotalForRootEvents([[a], [b]])).toBe(120);
  });

  it('returns 0 for an empty input', () => {
    expect(sumDurationTotalForRootEvents([])).toBe(0);
  });
});

describe('sumRootNodesOnly (Metric adapter)', () => {
  beforeEach(() => {
    nextTimestamp = 1;
  });

  it('extracts Metric.nodes and applies the root-only sum', () => {
    const parent = createEvent({ text: 'parent', total: 100 });
    const child = createEvent({ text: 'child', total: 60, parent });

    const metricParent = { nodes: [parent] } as unknown as Metric;
    const metricChild = { nodes: [child] } as unknown as Metric;
    expect(sumRootNodesOnly([], [metricParent, metricChild], {})).toBe(100);
  });
});
