/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { ApexLog, LogEvent } from 'apex-log-parser';
import { computeExecutionHighlights, getExecutionHighlights } from '../ExecutionHighlights.js';

// The parser takes 0 for the log itself, so real events start at 1.
let nextEventIndex = 1;
let nextStamp = 0;

/**
 * The slice of `LogEvent` the highlights pass reads: the tree links, the
 * timings, the stamps that tell a nested instance from a later one, the identity
 * fields behind `getEventKey`, and the truncation flag. Stamps default to a
 * fresh non-overlapping span, so an event nests only where a test says so.
 */
function createEvent(
  options: {
    text?: string;
    type?: string;
    category?: string;
    namespace?: string;
    self?: number;
    total?: number;
    timestamp?: number;
    exitStamp?: number;
    parent?: LogEvent;
    isTruncated?: boolean;
  } = {},
): LogEvent {
  const timestamp = options.timestamp ?? nextStamp++;
  const event = {
    text: options.text ?? 'event',
    type: options.type ?? 'METHOD_ENTRY',
    category: options.category ?? '',
    namespace: options.namespace ?? 'default',
    eventIndex: nextEventIndex++,
    duration: { self: options.self ?? 0, total: options.total ?? 0 },
    timestamp,
    exitStamp: options.exitStamp ?? timestamp,
    parent: options.parent ?? null,
    children: [],
    isTruncated: options.isTruncated ?? false,
  } as unknown as LogEvent;
  options.parent?.children.push(event);
  return event;
}

/**
 * The pseudo-root, holding the log's gap time as its own self time. It registers
 * itself as `eventsById[0]` exactly as the parser does, so the pass has to skip it.
 */
function createLog(total: number, self = 0): ApexLog {
  const log = {
    text: 'LOG_ROOT',
    eventIndex: 0,
    duration: { self, total },
    children: [],
    eventsById: [],
  } as unknown as ApexLog;
  log.eventsById.push(log as unknown as LogEvent);
  return log;
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
      eventIndexes: [root.eventIndex],
      totalTime: 900,
      selfTime: 0,
      count: 1,
      category: '',
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
      {
        text: 'Root',
        eventIndex: root.eventIndex,
        eventIndexes: [root.eventIndex],
        totalTime: 1000,
        selfTime: 0,
        count: 1,
        category: '',
      },
      {
        text: 'Repeat',
        eventIndex: worst.eventIndex,
        // Every instance the frame merges, so a hover marks all of them.
        eventIndexes: [worst.eventIndex - 1, worst.eventIndex],
        totalTime: 600,
        selfTime: 0,
        count: 2,
        category: '',
      },
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

  it('carries the group self time and the worst instance category', () => {
    const log = createLog(1000);
    const root = createEvent({ text: 'Root', category: 'Code Unit', total: 1000, self: 100 });
    log.children.push(root);
    createEvent({ text: 'Repeat', category: 'Apex', total: 300, self: 200, parent: root });
    createEvent({ text: 'Repeat', category: 'Apex', total: 500, self: 400, parent: root });

    const { hotPath } = computeExecutionHighlights(log);

    expect(hotPath[0]?.selfTime).toBe(100);
    expect(hotPath[0]?.category).toBe('Code Unit');
    expect(hotPath[1]?.selfTime).toBe(600);
    expect(hotPath[1]?.category).toBe('Apex');
  });

  it('holds a frame self time inside its total', () => {
    const log = createLog(1000);
    // A negative self on one instance drags the group's sum below zero; the
    // frame's own share of itself cannot sit outside its total.
    const root = createEvent({ text: 'Root', total: 500, self: -100 });
    log.children.push(root);

    const { hotPath } = computeExecutionHighlights(log);

    expect(hotPath[0]?.selfTime).toBe(0);
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

describe('computeExecutionHighlights hot path end', () => {
  it('names a last frame that keeps its own time as the hot spot', () => {
    const log = createLog(1000);
    const root = createEvent({ text: 'Root', total: 1000 });
    log.children.push(root);
    const big = createEvent({ text: 'Big', total: 900, self: 800, parent: root });
    createEvent({ text: 'Small', total: 100, parent: big });

    const { hotPath, hotPathEnd, hotPathBranches } = computeExecutionHighlights(log);

    expect(hotPath.map((frame) => frame.text)).toEqual(['Root', 'Big']);
    expect(hotPathEnd).toBe('hot-spot');
    // The frame does the work itself, so its children are no reading.
    expect(hotPathBranches).toEqual([]);
  });

  it('hands back the branches where the time fans out instead', () => {
    const log = createLog(1000);
    const root = createEvent({ text: 'Root', total: 1000, self: 100 });
    log.children.push(root);
    // No child holds the follow share, and the frame kept a tenth of its own
    // time, so the time fanned out here.
    const alpha = createEvent({ text: 'Alpha', total: 380, parent: root });
    createEvent({ text: 'Beta', total: 300, parent: root });
    createEvent({ text: 'Gamma', total: 280, parent: root });
    createEvent({ text: 'Tiny', total: 20, parent: root });

    const { hotPath, hotPathEnd, hotPathBranches } = computeExecutionHighlights(log);

    expect(hotPath.map((frame) => frame.text)).toEqual(['Root']);
    expect(hotPathEnd).toBe('fan-out');
    // Biggest first, and the child under a twentieth of the frame is noise.
    expect(hotPathBranches.map((branch) => branch.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(hotPathBranches[0]).toEqual({
      text: 'Alpha',
      eventIndex: alpha.eventIndex,
      eventIndexes: [alpha.eventIndex],
      totalTime: 380,
      selfTime: 0,
      count: 1,
      category: '',
    });
  });

  it('names no fan-out where the frame has no branch worth a row', () => {
    const log = createLog(1000);
    const root = createEvent({ text: 'Root', total: 1000, self: 100 });
    log.children.push(root);
    // The frame kept a tenth of its own time, but its one child is noise, so
    // there is nothing for a fan-out reading to point at.
    createEvent({ text: 'Tiny', total: 20, parent: root });

    const { hotPathEnd, hotPathBranches } = computeExecutionHighlights(log);

    expect(hotPathEnd).toBe('hot-spot');
    expect(hotPathBranches).toEqual([]);
  });

  it('merges same-signature branches, and points at the worst instance', () => {
    const log = createLog(1000);
    const root = createEvent({ text: 'Root', total: 1000, self: 100 });
    log.children.push(root);
    const first = createEvent({ text: 'Repeat', total: 100, parent: root });
    createEvent({ text: 'Other', total: 300, parent: root });
    const worst = createEvent({ text: 'Repeat', total: 200, parent: root });

    const { hotPathEnd, hotPathBranches } = computeExecutionHighlights(log);

    expect(hotPathEnd).toBe('fan-out');
    expect(hotPathBranches).toEqual([
      {
        text: 'Repeat',
        eventIndex: worst.eventIndex,
        eventIndexes: [first.eventIndex, worst.eventIndex],
        totalTime: 300,
        selfTime: 0,
        count: 2,
        category: '',
      },
      {
        text: 'Other',
        eventIndex: first.eventIndex + 1,
        eventIndexes: [first.eventIndex + 1],
        totalTime: 300,
        selfTime: 0,
        count: 1,
        category: '',
      },
    ]);
  });

  it('has no end to name in a log with no timed calls', () => {
    const highlights = computeExecutionHighlights(createLog(0));

    expect(highlights.hotPathEnd).toBe('hot-spot');
    expect(highlights.hotPathBranches).toEqual([]);
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

    // Nothing timed either signature's calls as a whole, so the total answers
    // with the self time — never below it, or the meter would overflow its bar.
    expect(hotSpots).toEqual([
      {
        text: 'MyClass.run()',
        eventIndex: worst.eventIndex,
        selfTime: 400,
        totalTime: 400,
        count: 2,
        category: '',
      },
      {
        text: 'Other.go()',
        eventIndex: other.eventIndex,
        selfTime: 50,
        totalTime: 50,
        count: 1,
        category: '',
      },
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
      {
        text: 'MyClass.run()',
        eventIndex: timed.eventIndex,
        selfTime: 60,
        totalTime: 60,
        count: 2,
        category: '',
      },
    ]);
    expect(untimed.eventIndex).not.toBe(hotSpots[0]?.eventIndex);
  });

  it('sums total time and takes the category from the worst instance', () => {
    const log = createLog(1000);
    const cheap = createEvent({ text: 'MyClass.run()', category: 'Apex', self: 20, total: 100 });
    const worst = createEvent({ text: 'MyClass.run()', category: 'SOQL', self: 80, total: 300 });
    index(log, cheap, worst);

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots[0]?.totalTime).toBe(400);
    expect(hotSpots[0]?.category).toBe('SOQL');
  });

  it('counts recursion total time once, over the outermost instance', () => {
    const log = createLog(1000);
    const outer = createEvent({
      text: 'Recurse.go()',
      self: 40,
      total: 300,
      timestamp: 100,
      exitStamp: 400,
    });
    const inner = createEvent({
      text: 'Recurse.go()',
      self: 60,
      total: 260,
      timestamp: 140,
      exitStamp: 400,
      parent: outer,
    });
    const later = createEvent({
      text: 'Recurse.go()',
      self: 20,
      total: 100,
      timestamp: 500,
      exitStamp: 600,
    });
    index(log, outer, inner, later);

    const { hotSpots } = computeExecutionHighlights(log);

    // Self time counts every level; total counts the outer call and the later
    // one, so the wall time is not charged twice.
    expect(hotSpots[0]?.selfTime).toBe(120);
    expect(hotSpots[0]?.totalTime).toBe(400);
    expect(hotSpots[0]?.count).toBe(3);
  });

  it('lifts a total left below the self time by untimed outer calls', () => {
    const log = createLog(1000);
    // The outer calls were never timed; only the nested one was, so the summed
    // self time (80) runs past the summed total (30).
    const outer = createEvent({ text: 'Wrap.run()', self: 0, total: 30, timestamp: 0 });
    const nested = createEvent({ text: 'Wrap.run()', self: 80, total: 0, parent: outer });
    index(log, outer, nested);

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots[0]?.totalTime).toBe(80);
  });

  it('ignores events with no self time', () => {
    const log = createLog(1000);
    index(log, createEvent({ text: 'Wrapper', self: 0, total: 500 }));

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots).toEqual([]);
  });

  it('never names the log itself, whatever gap time it holds', () => {
    // A truncated log leaves most of its time unaccounted, so the pseudo-root
    // outweighs every real call. It is a container, not code.
    const log = createLog(1000, 900);
    index(log, createEvent({ text: 'Work', self: 100, total: 100 }));

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots.map((row) => row.text)).toEqual(['Work']);
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
