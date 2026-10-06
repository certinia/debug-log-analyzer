/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from 'vitest';

import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import { createEvent } from '#test-helpers/events.js';
import { computeExecutionHighlights, getExecutionHighlights } from '../ExecutionHighlights.js';

// The parser takes 0 for the log itself, so real events start at 1.
let nextEventIndex = 1;

function highlightEvent(options: Parameters<typeof createEvent>[0]): LogEvent {
  return createEvent({ category: '', ...options, eventIndex: nextEventIndex++ });
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
    truncation: { regions: [], totalSkippedBytes: 0 },
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
    const root = highlightEvent({ text: 'Root', total: 900 });
    const small = highlightEvent({ text: 'Small', total: 100 });
    log.children.push(root, small);
    const big = highlightEvent({ text: 'Big', total: 800, parent: root });
    const side = highlightEvent({ text: 'Side', total: 90, parent: root });
    const leaf = highlightEvent({ text: 'Leaf', total: 700, parent: big });
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
    const root = highlightEvent({ text: 'Root', total: 1000 });
    log.children.push(root);
    // Each call alone is under the 0.4 follow share; merged (600) they are the
    // hot path. The frame points at the worst instance and carries the count.
    highlightEvent({ text: 'Repeat', total: 250, parent: root });
    const worst = highlightEvent({ text: 'Repeat', total: 350, parent: root });
    highlightEvent({ text: 'Other', total: 300, parent: root });

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
    const root = highlightEvent({ text: 'Root', total: 1000 });
    log.children.push(root);
    // 300 < 0.4 * 1000: the time has spread out, so the path ends at the root.
    highlightEvent({ text: 'Spread', total: 300, parent: root });
    highlightEvent({ text: 'Other', total: 250, parent: root });

    const { hotPath } = computeExecutionHighlights(log);

    expect(hotPath.map((f) => f.text)).toEqual(['Root']);
  });

  it('stops when the frame itself outweighs its largest child', () => {
    const log = createLog(1000);
    const root = highlightEvent({ text: 'Root', total: 1000, self: 550 });
    log.children.push(root);
    // 450 clears the follow share, but the root's own work (550) is bigger:
    // the root is the hot spot, so the path ends there.
    highlightEvent({ text: 'Child', total: 450, parent: root });

    const { hotPath } = computeExecutionHighlights(log);

    expect(hotPath.map((f) => f.text)).toEqual(['Root']);
  });

  it('carries the group self time and the worst instance category', () => {
    const log = createLog(1000);
    const root = highlightEvent({ text: 'Root', category: 'Code Unit', total: 1000, self: 100 });
    log.children.push(root);
    highlightEvent({ text: 'Repeat', category: 'Apex', total: 300, self: 200, parent: root });
    highlightEvent({ text: 'Repeat', category: 'Apex', total: 500, self: 400, parent: root });

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
    const root = highlightEvent({ text: 'Root', total: 500, self: -100 });
    log.children.push(root);

    const { hotPath } = computeExecutionHighlights(log);

    expect(hotPath[0]?.selfTime).toBe(0);
  });

  it('is empty when the log has no timed calls', () => {
    const log = createLog(0);
    const root = highlightEvent({ text: 'Root', total: 0 });
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
    const root = highlightEvent({ text: 'Root', total: 1000 });
    log.children.push(root);
    const big = highlightEvent({ text: 'Big', total: 900, self: 800, parent: root });
    highlightEvent({ text: 'Small', total: 100, parent: big });

    const { hotPath, hotPathEnd, hotPathBranches } = computeExecutionHighlights(log);

    expect(hotPath.map((frame) => frame.text)).toEqual(['Root', 'Big']);
    expect(hotPathEnd).toBe('hot-spot');
    // The frame does the work itself, so its children are no reading.
    expect(hotPathBranches).toEqual([]);
  });

  it('hands back the branches where the time fans out instead', () => {
    const log = createLog(1000);
    const root = highlightEvent({ text: 'Root', total: 1000, self: 100 });
    log.children.push(root);
    // No child holds the follow share, and the frame kept a tenth of its own
    // time, so the time fanned out here.
    const alpha = highlightEvent({ text: 'Alpha', total: 380, parent: root });
    highlightEvent({ text: 'Beta', total: 300, parent: root });
    highlightEvent({ text: 'Gamma', total: 280, parent: root });
    highlightEvent({ text: 'Tiny', total: 20, parent: root });

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
    const root = highlightEvent({ text: 'Root', total: 1000, self: 100 });
    log.children.push(root);
    // The frame kept a tenth of its own time, but its one child is noise, so
    // there is nothing for a fan-out reading to point at.
    highlightEvent({ text: 'Tiny', total: 20, parent: root });

    const { hotPathEnd, hotPathBranches } = computeExecutionHighlights(log);

    expect(hotPathEnd).toBe('hot-spot');
    expect(hotPathBranches).toEqual([]);
  });

  it('merges same-signature branches, and points at the worst instance', () => {
    const log = createLog(1000);
    const root = highlightEvent({ text: 'Root', total: 1000, self: 100 });
    log.children.push(root);
    const first = highlightEvent({ text: 'Repeat', total: 100, parent: root });
    highlightEvent({ text: 'Other', total: 300, parent: root });
    const worst = highlightEvent({ text: 'Repeat', total: 200, parent: root });

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
    const first = highlightEvent({ text: 'MyClass.run()', self: 100 });
    const worst = highlightEvent({ text: 'MyClass.run()', self: 300 });
    const other = highlightEvent({ text: 'Other.go()', self: 50 });
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
    const method = highlightEvent({ text: 'run', type: 'METHOD_ENTRY', self: 10 });
    const flow = highlightEvent({ text: 'run', type: 'FLOW_START_INTERVIEW_BEGIN', self: 20 });
    const packaged = highlightEvent({ text: 'run', namespace: 'pkg', self: 30 });
    index(log, method, flow, packaged);

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots).toHaveLength(3);
  });

  it('caps the list at five signatures, largest self time first', () => {
    const log = createLog(1000);
    for (let i = 1; i <= 7; i++) {
      index(log, highlightEvent({ text: `M${i}`, self: i * 10 }));
    }

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots.map((s) => s.text)).toEqual(['M7', 'M6', 'M5', 'M4', 'M3']);
  });

  it('counts untimed instances of a timed signature, so the average holds', () => {
    const log = createLog(1000);
    const timed = highlightEvent({ text: 'MyClass.run()', self: 60 });
    const untimed = highlightEvent({ text: 'MyClass.run()', self: 0 });
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
    const cheap = highlightEvent({ text: 'MyClass.run()', category: 'Apex', self: 20, total: 100 });
    const worst = highlightEvent({ text: 'MyClass.run()', category: 'SOQL', self: 80, total: 300 });
    index(log, cheap, worst);

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots[0]?.totalTime).toBe(400);
    expect(hotSpots[0]?.category).toBe('SOQL');
  });

  it('counts recursion total time once, over the outermost instance', () => {
    const log = createLog(1000);
    const outer = highlightEvent({
      text: 'Recurse.go()',
      self: 40,
      total: 300,
      timestamp: 100,
      exitStamp: 400,
    });
    const inner = highlightEvent({
      text: 'Recurse.go()',
      self: 60,
      total: 260,
      timestamp: 140,
      exitStamp: 400,
      parent: outer,
    });
    const later = highlightEvent({
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
    const outer = highlightEvent({ text: 'Wrap.run()', self: 0, total: 30, timestamp: 0 });
    const nested = highlightEvent({ text: 'Wrap.run()', self: 80, total: 0, parent: outer });
    index(log, outer, nested);

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots[0]?.totalTime).toBe(80);
  });

  it('ignores events with no self time', () => {
    const log = createLog(1000);
    index(log, highlightEvent({ text: 'Wrapper', self: 0, total: 500 }));

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots).toEqual([]);
  });

  it('never names the log itself, whatever gap time it holds', () => {
    // A truncated log leaves most of its time unaccounted, so the pseudo-root
    // outweighs every real call. It is a container, not code.
    const log = createLog(1000, 900);
    index(log, highlightEvent({ text: 'Work', self: 100, total: 100 }));

    const { hotSpots } = computeExecutionHighlights(log);

    expect(hotSpots.map((row) => row.text)).toEqual(['Work']);
  });
});

describe('computeExecutionHighlights truncation', () => {
  it('reports the regions the parser found, and where the first one starts', () => {
    const log = createLog(1000);
    log.truncation = {
      regions: [
        { kind: 'skipped-lines', startTime: 10, eventIndex: 7, skippedBytes: 1000 },
        { kind: 'max-size', startTime: 20, eventIndex: 9 },
      ],
      totalSkippedBytes: 1000,
    };

    const { truncation } = computeExecutionHighlights(log);

    expect(truncation).toEqual({ regionCount: 2, firstEventIndex: 7 });
  });

  // The parser sets `isTruncated` on the log root as well as on each cut-off frame, so
  // counting flagged events whose parent is not flagged found nothing on a real log.
  it('reports a truncation whose cut-off frames all hang off the log root', () => {
    const log = createLog(1000);
    log.isTruncated = true;
    const cut = highlightEvent({
      text: 'Cut',
      parent: log as unknown as LogEvent,
      isTruncated: true,
    });
    index(log, cut);
    log.truncation = {
      regions: [{ kind: 'max-size', startTime: 10, eventIndex: cut.eventIndex }],
      totalSkippedBytes: 0,
    };

    const { truncation } = computeExecutionHighlights(log);

    expect(truncation).toEqual({ regionCount: 1, firstEventIndex: cut.eventIndex });
  });

  it('reports nothing for a log the platform did not truncate', () => {
    const log = createLog(1000);
    index(log, highlightEvent({ text: 'Work', self: 100 }));

    expect(computeExecutionHighlights(log).truncation).toBeNull();
  });
});

describe('getExecutionHighlights', () => {
  it('memoises per log', () => {
    const log = createLog(1000);
    index(log, highlightEvent({ text: 'M', self: 10 }));

    expect(getExecutionHighlights(log)).toBe(getExecutionHighlights(log));
  });
});
