/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { indexOf } from '#test-helpers/apexLog.js';
import { framesOf } from '#test-helpers/timeline.js';

const NESTED =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1100)|STATEMENT_EXECUTE|[2]\n' +
  '09:18:22.6 (1200)|METHOD_ENTRY|[3]|01p|ns.Inner.first()\n' +
  '09:18:22.6 (1300)|SOQL_EXECUTE_BEGIN|[4]|Aggregations:0|SELECT Id FROM Account\n' +
  '09:18:22.6 (1400)|SOQL_EXECUTE_END|[4]|Rows:1\n' +
  '09:18:22.6 (1500)|METHOD_EXIT|[3]|ns.Inner.first()\n' +
  '09:18:22.6 (1600)|METHOD_ENTRY|[5]|01p|ns.Inner.second()\n' +
  '09:18:22.6 (1700)|METHOD_EXIT|[5]|ns.Inner.second()\n' +
  '09:18:22.6 (1800)|METHOD_EXIT|[1]|ns.Outer.run()\n';

describe('buildTimelineFrames', () => {
  it('draws a rect for every shown frame, and none for a frame with no duration', async () => {
    const { frames } = await framesOf(NESTED);
    const texts = [...frames.rectsByCategory.values()]
      .flat()
      .map((rect) => frames.text(rect.row))
      .sort();

    expect(texts).toEqual([
      'EXECUTION_STARTED',
      'SELECT Id FROM Account',
      'apex://pkg.Entry',
      'ns.Inner.first()',
      'ns.Inner.second()',
      'ns.Outer.run()',
    ]);
    for (const rects of frames.rectsByDepth.values()) {
      for (const rect of rects) {
        expect(rect.timeEnd).toBe(rect.timeStart + rect.duration);
        expect(frames.rectOf(Number(rect.id))).toBe(rect);
      }
    }
  });

  it('lists the shown rows at each depth in start order', async () => {
    const { frames } = await framesOf(NESTED);
    // Execution, then code unit, then the body's own frames.
    const inner = [...frames.rowsAtDepth(3)].map((row) => frames.text(row));

    expect(inner).toEqual(['ns.Inner.first()', 'ns.Inner.second()']);
    expect(frames.maxDepth).toBe(4);
    expect(frames.rowsAtDepth(99)).toHaveLength(0);
  });

  it('does not show a frame with no duration', async () => {
    const { log, frames } = await framesOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Instant.run()\n' +
        '09:18:22.6 (1000)|METHOD_EXIT|[1]|ns.Instant.run()\n',
    );
    const instant = log.event(indexOf(log, 'ns.Instant.run()'));

    expect(frames.rowOfOriginal(instant)).toBe(-1);
    expect(frames.rowOfOriginal({})).toBe(-1);
    expect(frames.rowOfOriginal(undefined)).toBe(-1);
  });

  it('makes a node that carries the parsed event', async () => {
    const { log, frames } = await framesOf(NESTED);
    const outer = indexOf(log, 'ns.Outer.run()');
    const row = frames.rowOfOriginal(log.event(outer));
    const node = frames.node(row);

    expect(node).toMatchObject({
      row,
      depth: 2,
      data: {
        id: String(row),
        timestamp: 1000,
        duration: 800,
        type: 'METHOD_ENTRY',
        text: 'ns.Outer.run()',
        original: { id: outer },
      },
    });
  });

  describe('totalDuration', () => {
    it('reaches the last frame when the log ends with it', async () => {
      const { log, frames } = await framesOf(NESTED);
      const { frames: atEnd } = await framesOf(NESTED, log.columns.endTimestamp[0]);

      expect(frames.totalDuration).toBe(atEnd.totalDuration);
    });

    it('reaches the log end when the frames stop short of it', async () => {
      // A truncated log: the trailing FATAL_ERROR that closes it carries no duration.
      const { frames } = await framesOf(NESTED, 9_000_000);

      expect(frames.totalDuration).toBe(9_000_000);
    });

    it('still reaches the last frame when it outlives the given log end', async () => {
      const { log, frames } = await framesOf(NESTED, 100);
      const ends = log.children.map((event) => event.endTimestamp);

      expect(frames.totalDuration).toBe(Math.max(...ends));
    });
  });
});
