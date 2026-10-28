/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { buildLogIndex } from '#core/log/LogIndex.js';
import { idOf } from '#test-helpers/apexLog.js';
import { framesOf } from '#test-helpers/timeline.js';
import { NO_ROW } from '../types/flamechart.types.js';
import { buildTimelineFrames, drawnRowAtOrAbove } from '../utils/timeline-frames.js';

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

  // The segment tree trusts this order; a log whose clock goes backwards breaks pre-order's.
  it('lists the rows with a rect at each depth in start order, though the log runs backwards', async () => {
    const { log, frames } = await framesOf(
      '09:18:22.6 (2000)|METHOD_ENTRY|[1]|01p|ns.Late.run()\n' +
        '09:18:22.6 (2100)|METHOD_EXIT|[1]|ns.Late.run()\n' +
        '09:18:22.6 (1000)|METHOD_ENTRY|[2]|01p|ns.Early.run()\n' +
        '09:18:22.6 (1100)|METHOD_EXIT|[2]|ns.Early.run()\n',
    );
    const late = frames.rowOfOriginal(log.event(idOf(log, 'ns.Late.run()')));
    const rows = frames.rectRowsByDepth[frames.depth[late]!]!;

    expect([...rows].map((row) => frames.text(row))).toEqual(['ns.Early.run()', 'ns.Late.run()']);
  });

  it('lists no row for a frame whose category the timeline does not draw', async () => {
    const { log } = await framesOf(NESTED);
    const frames = buildTimelineFrames(buildLogIndex(log), new Set(['Apex']), 0);
    const listed = frames.rectRowsByDepth.flatMap((rows) =>
      [...rows].map((row) => frames.text(row)),
    );

    expect(listed).toContain('ns.Inner.first()');
    expect(listed).not.toContain('SELECT Id FROM Account');
  });

  it('does not show a frame with no duration', async () => {
    const { log, frames } = await framesOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Instant.run()\n' +
        '09:18:22.6 (1000)|METHOD_EXIT|[1]|ns.Instant.run()\n',
    );
    const instant = log.event(idOf(log, 'ns.Instant.run()'));

    expect(frames.rowOfOriginal(instant)).toBe(-1);
    expect(frames.rowOfOriginal({})).toBe(-1);
    expect(frames.rowOfOriginal(undefined)).toBe(-1);
  });

  it('makes a node that carries the parsed event', async () => {
    const { log, frames } = await framesOf(NESTED);
    const outer = idOf(log, 'ns.Outer.run()');
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

describe('drawnRowAtOrAbove', () => {
  it('gives a drawn frame itself', async () => {
    const { log, index, frames } = await framesOf(NESTED);
    const inner = idOf(log, 'ns.Inner.first()');

    expect(drawnRowAtOrAbove(index, frames, inner)).toBe(index.rowOf(inner));
  });

  // A hidden event has no row at all, so it climbs the log, not the index.
  it('gives an event the log levels hide its nearest shown frame', async () => {
    const { log } = await framesOf(NESTED);
    const inner = idOf(log, 'ns.Inner.first()');
    const hidden = new Uint8Array(log.eventCount + 1);
    hidden[inner] = 1;
    const index = buildLogIndex(log, hidden);
    const frames = buildTimelineFrames(index, new Set(['Apex', 'SOQL']), 0);

    expect(frames.text(drawnRowAtOrAbove(index, frames, inner))).toBe('ns.Outer.run()');
  });

  it('gives no row for an id the log does not hold', async () => {
    const { index, frames } = await framesOf(NESTED);

    expect(drawnRowAtOrAbove(index, frames, 9999)).toBe(NO_ROW);
  });
});
