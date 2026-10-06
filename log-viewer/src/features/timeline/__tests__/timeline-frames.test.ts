/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { storeOf } from '#test-helpers/apexLog.js';
import { buildLogIndex } from '../../../core/log/LogIndex.js';
import { BUCKET_CONSTANTS } from '../types/flamechart.types.js';
import { buildTimelineFrames } from '../utils/timeline-frames.js';

const CATEGORIES = new Set<string>(BUCKET_CONSTANTS.CATEGORY_PRIORITY);

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

function framesOf(body: string, logEnd = 0) {
  const { log } = storeOf(body);
  const index = buildLogIndex(log);
  return { log, index, frames: buildTimelineFrames(index, CATEGORIES, logEnd) };
}

describe('buildTimelineFrames', () => {
  it('draws a rect for every shown frame, and none for a frame with no duration', () => {
    const { frames } = framesOf(NESTED);
    const texts = [...frames.rectsByCategory.values()]
      .flat()
      .map((rect) => rect.eventRef.text)
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

  it('lists the shown rows at each depth in start order', () => {
    const { frames } = framesOf(NESTED);
    // Execution, then code unit, then the body's own frames.
    const inner = [...frames.rowsAtDepth(3)].map((row) => frames.text(row));

    expect(inner).toEqual(['ns.Inner.first()', 'ns.Inner.second()']);
    expect(frames.maxDepth).toBe(4);
    expect(frames.rowsAtDepth(99)).toHaveLength(0);
  });

  it('does not show a frame with no duration', () => {
    const { log, frames } = framesOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Instant.run()\n' +
        '09:18:22.6 (1000)|METHOD_EXIT|[1]|ns.Instant.run()\n',
    );
    const instant = log.eventsById.find((event) => event.text === 'ns.Instant.run()')!;

    expect(frames.rowOfOriginal(instant)).toBe(-1);
    expect(frames.rowOfOriginal({})).toBe(-1);
    expect(frames.rowOfOriginal(undefined)).toBe(-1);
  });

  it('makes a node that carries the parsed event', () => {
    const { log, frames } = framesOf(NESTED);
    const outer = log.eventsById.find((event) => event.text === 'ns.Outer.run()')!;
    const row = frames.rowOfOriginal(outer);
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
        original: outer,
      },
    });
  });

  describe('totalDuration', () => {
    it('reaches the last frame when the log ends with it', () => {
      const { log, frames } = framesOf(NESTED);
      const { frames: atEnd } = framesOf(NESTED, log.exitStamp);

      expect(frames.totalDuration).toBe(atEnd.totalDuration);
    });

    it('reaches the log end when the frames stop short of it', () => {
      // A truncated log: the trailing FATAL_ERROR that closes it carries no duration.
      const { frames } = framesOf(NESTED, 9_000_000);

      expect(frames.totalDuration).toBe(9_000_000);
    });

    it('still reaches the last frame when it outlives the given log end', () => {
      const { log, frames } = framesOf(NESTED, 100);
      const ends = log.children.map((event) => event.exitStamp ?? 0);

      expect(frames.totalDuration).toBe(Math.max(...ends));
    });
  });
});
