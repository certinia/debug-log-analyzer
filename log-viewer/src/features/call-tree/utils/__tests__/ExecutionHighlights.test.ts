/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  frameLines,
  indexesOf,
  rawStoreOf,
  storeOf,
  type FrameSpec,
} from '#test-helpers/apexLog.js';
import type { LogStore } from '../../../../core/log/LogStore.js';
import { executionHighlights, type ExecutionHighlights } from '../ExecutionHighlights.js';

/** A method that spends `self` ns before its children; its total is that plus theirs. */
const m = (text: string, self: number, ...children: FrameSpec[]): FrameSpec => ({
  text,
  self,
  children,
});
/** A code unit, as {@link m}. */
const cu = (text: string, self: number, ...children: FrameSpec[]): FrameSpec => ({
  text,
  self,
  type: 'CODE_UNIT_STARTED',
  children,
});

async function highlightsOf(
  ...specs: FrameSpec[]
): Promise<ExecutionHighlights & { ids: (text: string) => number[] }> {
  const { store } = await rawStoreOf(frameLines(specs));
  return {
    ...(await store.derive(executionHighlights)),
    ids: (text) => indexesOf(store.log, text),
  };
}

describe('executionHighlights hot path', () => {
  it('follows the largest-total child from the root down', async () => {
    const { hotPath, ids } = await highlightsOf(
      m('Root', 0, m('Big', 100, m('Leaf', 700)), m('Side', 90)),
      m('Small', 100),
    );

    expect(hotPath.map((f) => f.text)).toEqual(['Root', 'Big', 'Leaf']);
    expect(hotPath[0]).toEqual({
      text: 'Root',
      eventIndex: ids('Root')[0],
      eventIndexes: ids('Root'),
      totalTime: 890,
      selfTime: 0,
      count: 1,
      category: 'Apex',
    });
  });

  it('merges same-signature siblings into one frame and follows their sum', async () => {
    // Each call alone is under the 0.4 follow share of 900; merged (600) they are the
    // hot path. The frame points at the worst instance and carries the count.
    const { hotPath, ids } = await highlightsOf(
      m('Root', 0, m('Repeat', 250), m('Repeat', 350), m('Other', 300)),
    );
    const repeats = ids('Repeat');

    expect(hotPath[1]).toEqual({
      text: 'Repeat',
      eventIndex: repeats[1],
      // Every instance the frame merges, so a hover marks all of them.
      eventIndexes: repeats,
      totalTime: 600,
      selfTime: 600,
      count: 2,
      category: 'Apex',
    });
  });

  it('stops when the largest child falls below the follow share', async () => {
    // 300 < 0.4 * 1000: the time has spread out, so the path ends at the root.
    const { hotPath } = await highlightsOf(m('Root', 450, m('Spread', 300), m('Other', 250)));

    expect(hotPath.map((f) => f.text)).toEqual(['Root']);
  });

  it('stops when the frame itself outweighs its largest child', async () => {
    // 450 clears the follow share, but the root's own work (550) is bigger:
    // the root is the hot spot, so the path ends there.
    const { hotPath } = await highlightsOf(m('Root', 550, m('Child', 450)));

    expect(hotPath.map((f) => f.text)).toEqual(['Root']);
  });

  it('carries the group self time and the worst instance category', async () => {
    const { hotPath } = await highlightsOf(
      cu('Root', 100, m('Repeat', 200, m('Work', 100)), m('Repeat', 400, m('Work', 100))),
    );

    expect(hotPath[0]?.selfTime).toBe(100);
    expect(hotPath[0]?.category).toBe('Code Unit');
    expect(hotPath[1]?.selfTime).toBe(600);
    expect(hotPath[1]?.category).toBe('Apex');
  });

  it('is empty when the log has no timed calls', async () => {
    const highlights = await highlightsOf(m('Root', 0));

    expect(highlights.hotPath).toEqual([]);
    expect(highlights.hotSpots).toEqual([]);
    expect(highlights.truncation).toBeNull();
  });
});

describe('executionHighlights hot path end', () => {
  it('names a last frame that keeps its own time as the hot spot', async () => {
    const { hotPath, hotPathEnd, hotPathBranches } = await highlightsOf(
      m('Root', 0, m('Big', 800, m('Small', 100))),
    );

    expect(hotPath.map((frame) => frame.text)).toEqual(['Root', 'Big']);
    expect(hotPathEnd).toBe('hot-spot');
    // The frame does the work itself, so its children are no reading.
    expect(hotPathBranches).toEqual([]);
  });

  it('hands back the branches where the time fans out instead', async () => {
    // No child holds the follow share of 1,080, and the frame kept under half its own
    // time, so the time fanned out here.
    const { hotPath, hotPathEnd, hotPathBranches, ids } = await highlightsOf(
      m('Root', 100, m('Alpha', 380), m('Beta', 300), m('Gamma', 280), m('Tiny', 20)),
    );

    expect(hotPath.map((frame) => frame.text)).toEqual(['Root']);
    expect(hotPathEnd).toBe('fan-out');
    // Biggest first, and the child under a twentieth of the frame is noise.
    expect(hotPathBranches.map((branch) => branch.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(hotPathBranches[0]).toEqual({
      text: 'Alpha',
      eventIndex: ids('Alpha')[0],
      eventIndexes: ids('Alpha'),
      totalTime: 380,
      selfTime: 380,
      count: 1,
      category: 'Apex',
    });
  });

  it('names no fan-out where the frame has no branch worth a row', async () => {
    // The frame kept a ninth of its own time, but every child is under a twentieth
    // of it, so there is nothing for a fan-out reading to point at.
    const noise = Array.from({ length: 20 }, (_, i) => m(`Tiny${i}`, 4));
    const { hotPathEnd, hotPathBranches } = await highlightsOf(m('Root', 10, ...noise));

    expect(hotPathEnd).toBe('hot-spot');
    expect(hotPathBranches).toEqual([]);
  });

  it('merges same-signature branches, and points at the worst instance', async () => {
    const { hotPathEnd, hotPathBranches, ids } = await highlightsOf(
      m('Root', 400, m('Repeat', 100), m('Other', 300), m('Repeat', 200)),
    );
    const repeats = ids('Repeat');

    expect(hotPathEnd).toBe('fan-out');
    expect(hotPathBranches).toEqual([
      {
        text: 'Repeat',
        eventIndex: repeats[1],
        eventIndexes: repeats,
        totalTime: 300,
        selfTime: 300,
        count: 2,
        category: 'Apex',
      },
      {
        text: 'Other',
        eventIndex: ids('Other')[0],
        eventIndexes: ids('Other'),
        totalTime: 300,
        selfTime: 300,
        count: 1,
        category: 'Apex',
      },
    ]);
  });

  it('has no end to name in a log with no timed calls', async () => {
    const highlights = await highlightsOf(m('Root', 0));

    expect(highlights.hotPathEnd).toBe('hot-spot');
    expect(highlights.hotPathBranches).toEqual([]);
  });
});

describe('executionHighlights hot spots', () => {
  it('sums self time by signature and points at the most expensive instance', async () => {
    const { hotSpots, ids } = await highlightsOf(
      m('MyClass.run()', 100),
      m('MyClass.run()', 300),
      m('Other.go()', 50),
    );

    expect(hotSpots).toEqual([
      {
        text: 'MyClass.run()',
        eventIndex: ids('MyClass.run()')[1],
        selfTime: 400,
        totalTime: 400,
        count: 2,
        category: 'Apex',
      },
      {
        text: 'Other.go()',
        eventIndex: ids('Other.go()')[0],
        selfTime: 50,
        totalTime: 50,
        count: 1,
        category: 'Apex',
      },
    ]);
  });

  it('breaks a tie by the signature timed first, as the other panes do', async () => {
    const { hotSpots } = await highlightsOf(m('B', 0), m('A', 10), m('B', 10));

    expect(hotSpots.map((row) => row.text)).toEqual(['A', 'B']);
  });

  it('keeps same-named events with different types apart', async () => {
    const { hotSpots } = await highlightsOf(m('run', 10), cu('run', 20));

    expect(hotSpots).toHaveLength(2);
  });

  it('caps the list at five signatures, largest self time first', async () => {
    const { hotSpots } = await highlightsOf(
      ...Array.from({ length: 7 }, (_, i) => m(`M${i + 1}`, (i + 1) * 10)),
    );

    expect(hotSpots.map((s) => s.text)).toEqual(['M7', 'M6', 'M5', 'M4', 'M3']);
  });

  it('counts untimed instances of a timed signature, so the average holds', async () => {
    const { hotSpots, ids } = await highlightsOf(m('MyClass.run()', 60), m('MyClass.run()', 0));
    const [timed, untimed] = ids('MyClass.run()');

    expect(hotSpots).toEqual([
      {
        text: 'MyClass.run()',
        eventIndex: timed,
        selfTime: 60,
        totalTime: 60,
        count: 2,
        category: 'Apex',
      },
    ]);
    expect(untimed).not.toBe(hotSpots[0]?.eventIndex);
  });

  it('sums total time and takes the category from the worst instance', async () => {
    const { hotSpots } = await highlightsOf(
      cu('Unit', 20, m('Work', 80)),
      cu('Unit', 80, m('Other', 220)),
    );

    expect(hotSpots.find((row) => row.text === 'Unit')).toMatchObject({
      totalTime: 400,
      category: 'Code Unit',
    });
  });

  it('counts recursion total time once, over the outermost instance', async () => {
    const { hotSpots } = await highlightsOf(
      m('Recurse.go()', 40, m('Recurse.go()', 60, m('Work', 200))),
      m('Recurse.go()', 20, m('More', 80)),
    );
    const recurse = hotSpots.find((row) => row.text === 'Recurse.go()');

    // Self time counts every level; total counts the outer call and the later
    // one (300 + 100), so the wall time is not charged twice.
    expect(recurse?.selfTime).toBe(120);
    expect(recurse?.totalTime).toBe(400);
    expect(recurse?.count).toBe(3);
  });

  it('ignores events with no self time', async () => {
    const { hotSpots } = await highlightsOf(m('Wrapper', 0));

    expect(hotSpots).toEqual([]);
  });
});

describe('executionHighlights truncation', () => {
  const line = (at: number, rest: string): string => `09:18:22.6 (${at})|${rest}\n`;
  const method = (start: number, name: string): string =>
    line(start, `METHOD_ENTRY|[1]|01p|${name}`) + line(start + 1000, `METHOD_EXIT|[1]|${name}`);

  async function truncationOf(
    body: string,
  ): Promise<{ store: LogStore; highlights: ExecutionHighlights }> {
    const { store } = await rawStoreOf(body);
    return { store, highlights: await store.derive(executionHighlights) };
  }

  it('reports the regions the parser found, and where the first one starts', async () => {
    const { store, highlights } = await truncationOf(
      method(1000, 'ns.A.run()') +
        '*** Skipped 12345 bytes of detailed log\n' +
        method(5000, 'ns.B.run()') +
        '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n' +
        method(8000, 'ns.C.run()'),
    );

    // The first region opens after A, the last event the log wrote before the cut.
    expect(highlights.truncation).toEqual({
      regionCount: 2,
      firstEventIndex: indexesOf(store.log, 'ns.A.run()')[0],
    });
  });

  it('reports nothing for a log the platform did not truncate', async () => {
    const { highlights } = await truncationOf(method(1000, 'ns.A.run()'));

    expect(highlights.truncation).toBeNull();
  });
});

describe('executionHighlights', () => {
  it('reads a parsed log through its store', async () => {
    const { store } = await storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1800)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const { hotSpots } = await store.derive(executionHighlights);

    expect(hotSpots.map((row) => row.text)).toContain('ns.Outer.run()');
  });
});
