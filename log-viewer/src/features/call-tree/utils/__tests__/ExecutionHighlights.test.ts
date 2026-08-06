/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { ApexLog, LogEvent } from 'apex-log-parser';
import { computeExecutionHighlights, getExecutionHighlights } from '../ExecutionHighlights.js';

let nextEventIndex = 0;

/**
 * The slice of `LogEvent` the highlights pass reads: the tree links, the
 * timings, the identity fields behind `getEventKey`, and the truncation flag.
 */
function createEvent(
  options: {
    text?: string;
    type?: string;
    namespace?: string;
    self?: number;
    total?: number;
    parent?: LogEvent;
    isTruncated?: boolean;
  } = {},
): LogEvent {
  const event = {
    text: options.text ?? 'event',
    type: options.type ?? 'METHOD_ENTRY',
    namespace: options.namespace ?? 'default',
    eventIndex: nextEventIndex++,
    duration: { self: options.self ?? 0, total: options.total ?? 0 },
    parent: options.parent ?? null,
    children: [],
    isTruncated: options.isTruncated ?? false,
  } as unknown as LogEvent;
  options.parent?.children.push(event);
  return event;
}

function createLog(total: number): ApexLog {
  return {
    duration: { self: 0, total },
    children: [],
    eventsById: [],
  } as unknown as ApexLog;
}

/** Register tree events on the flat lookup, the way the parser does. */
function index(log: ApexLog, ...events: LogEvent[]): void {
  log.eventsById.push(...events);
}

describe('computeExecutionHighlights hot path', () => {
  it('follows the largest-total child from the root down', () => {
    const log = createLog(1000);
    const root = createEvent({ text: 'Root', total: 900 });
    const small = createEvent({ text: 'Small', total: 100 });
    log.children.push(root, small);
    const big = createEvent({ text: 'Big', total: 800, parent: root });
    const side = createEvent({ text: 'Side', total: 90, parent: root });
    const leaf = createEvent({ text: 'Leaf', total: 700, parent: big });
    index(log, root, small, big, side, leaf);

    const { hotPath } = computeExecutionHighlights(log);

    expect(hotPath.map((f) => f.text)).toEqual(['Root', 'Big', 'Leaf']);
    expect(hotPath[0]).toEqual({
      text: 'Root',
      eventIndex: root.eventIndex,
      totalTime: 900,
      count: 1,
    });
  });

  it('merges same-signature siblings into one frame and follows their sum', () => {
    const log = createLog(1000);
    const root = createEvent({ text: 'Root', total: 1000 });
    log.children.push(root);
    // Each call alone is under the 0.4 follow share; merged (600) they are the
    // hot path. The frame points at the worst instance and carries the count.
    createEvent({ text: 'Repeat', total: 250, parent: root });
    const worst = createEvent({ text: 'Repeat', total: 350, parent: root });
    createEvent({ text: 'Other', total: 300, parent: root });

    const { hotPath } = computeExecutionHighlights(log);

    expect(hotPath).toEqual([
      { text: 'Root', eventIndex: root.eventIndex, totalTime: 1000, count: 1 },
      { text: 'Repeat', eventIndex: worst.eventIndex, totalTime: 600, count: 2 },
    ]);
  });

  it('stops when the largest child falls below the follow share', () => {
    const log = createLog(1000);
    const root = createEvent({ text: 'Root', total: 1000 });
    log.children.push(root);
    // 300 < 0.4 * 1000: the time has spread out, so the path ends at the root.
    createEvent({ text: 'Spread', total: 300, parent: root });
    createEvent({ text: 'Other', total: 250, parent: root });

    const { hotPath } = computeExecutionHighlights(log);

    expect(hotPath.map((f) => f.text)).toEqual(['Root']);
  });

  it('stops when the frame itself outweighs its largest child', () => {
    const log = createLog(1000);
    const root = createEvent({ text: 'Root', total: 1000, self: 550 });
    log.children.push(root);
    // 450 clears the follow share, but the root's own work (550) is bigger:
    // the root is the hot spot, so the path ends there.
    createEvent({ text: 'Child', total: 450, parent: root });

    const { hotPath } = computeExecutionHighlights(log);

    expect(hotPath.map((f) => f.text)).toEqual(['Root']);
  });

  it('is empty when the log has no timed calls', () => {
    const log = createLog(0);
    const root = createEvent({ text: 'Root', total: 0 });
    log.children.push(root);
    index(log, root);

    const highlights = computeExecutionHighlights(log);

    expect(highlights.hotPath).toEqual([]);
    expect(highlights.hotSpots).toEqual([]);
    expect(highlights.truncation).toBeNull();
  });
});

describe('computeExecutionHighlights hot spots', () => {
  it('sums self time by signature and points at the most expensive instance', () => {
    const log = createLog(1000);
    const first = createEvent({ text: 'MyClass.run()', self: 100 });
    const worst = createEvent({ text: 'MyClass.run()', self: 300 });
    const other = createEvent({ text: 'Other.go()', self: 50 });
    index(log, first, worst, other);

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots).toEqual([
      { text: 'MyClass.run()', eventIndex: worst.eventIndex, selfTime: 400, count: 2 },
      { text: 'Other.go()', eventIndex: other.eventIndex, selfTime: 50, count: 1 },
    ]);
  });

  it('keeps same-named events with different types or namespaces apart', () => {
    const log = createLog(1000);
    const method = createEvent({ text: 'run', type: 'METHOD_ENTRY', self: 10 });
    const flow = createEvent({ text: 'run', type: 'FLOW_START_INTERVIEW_BEGIN', self: 20 });
    const packaged = createEvent({ text: 'run', namespace: 'pkg', self: 30 });
    index(log, method, flow, packaged);

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots).toHaveLength(3);
  });

  it('caps the list at five signatures, largest self time first', () => {
    const log = createLog(1000);
    for (let i = 1; i <= 7; i++) {
      index(log, createEvent({ text: `M${i}`, self: i * 10 }));
    }

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots.map((s) => s.text)).toEqual(['M7', 'M6', 'M5', 'M4', 'M3']);
  });

  it('counts untimed instances of a timed signature, so the average holds', () => {
    const log = createLog(1000);
    const timed = createEvent({ text: 'MyClass.run()', self: 60 });
    const untimed = createEvent({ text: 'MyClass.run()', self: 0 });
    index(log, timed, untimed);

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots).toEqual([
      { text: 'MyClass.run()', eventIndex: timed.eventIndex, selfTime: 60, count: 2 },
    ]);
    expect(untimed.eventIndex).not.toBe(hotSpots[0]?.eventIndex);
  });

  it('ignores events with no self time', () => {
    const log = createLog(1000);
    index(log, createEvent({ text: 'Wrapper', self: 0, total: 500 }));

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots).toEqual([]);
  });
});

describe('computeExecutionHighlights truncation', () => {
  it('counts a flagged chain as one region and returns the first event', () => {
    const log = createLog(1000);
    const cut = createEvent({ text: 'Cut', isTruncated: true });
    const childInCut = createEvent({ text: 'Child', parent: cut, isTruncated: true });
    const laterCut = createEvent({ text: 'Later', isTruncated: true });
    index(log, cut, childInCut, laterCut);

    const { truncation } = computeExecutionHighlights(log);

    expect(truncation).toEqual({ regionCount: 2, firstEventIndex: cut.eventIndex });
  });
});

describe('getExecutionHighlights', () => {
  it('memoises per log', () => {
    const log = createLog(1000);
    index(log, createEvent({ text: 'M', self: 10 }));

    expect(getExecutionHighlights(log)).toBe(getExecutionHighlights(log));
  });
});
