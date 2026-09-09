/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for MinimapDensityQuery
 *
 * Tests category resolution for minimap coloring: that a long-spanning parent
 * holds every bucket its children do not, and that the skyline's on-top time
 * picks the dominant category.
 */
import { describe, expect, it } from '@jest/globals';
import type { LogEvent } from 'apex-log-parser';

import { MinimapDensityQuery } from '../optimised/minimap/MinimapDensityQuery.js';
import type { PrecomputedRect } from '../optimised/RectangleCache.js';

/**
 * Helper to create a mock PrecomputedRect.
 */
function createRect(
  category: string,
  timeStart: number,
  timeEnd: number,
  depth: number,
): PrecomputedRect {
  const duration = timeEnd - timeStart;
  return {
    id: `${category}-${timeStart}-${depth}`,
    timeStart,
    timeEnd,
    depth,
    duration,
    selfDuration: duration,
    category,
    x: 0,
    y: 0,
    width: 0,
    height: 20,
    eventRef: { timestamp: timeStart } as LogEvent,
  };
}

function buildQuery(rects: PrecomputedRect[], totalDuration: number): MinimapDensityQuery {
  const rectsByCategory = new Map<string, PrecomputedRect[]>();
  for (const rect of rects) {
    let grouped = rectsByCategory.get(rect.category);
    if (!grouped) {
      grouped = [];
      rectsByCategory.set(rect.category, grouped);
    }
    grouped.push(rect);
  }
  // maxDepth only reaches MinimapDensityData.globalMaxDepth; the sweep derives its own.
  return new MinimapDensityQuery([...rectsByCategory.values()], totalDuration, 0);
}

describe('MinimapDensityQuery', () => {
  describe('category resolution with long-spanning parent frames', () => {
    /**
     * Regression test: a long parent Method frame spanning many buckets, with a
     * short DML child in the middle. The parent must hold every bucket the child
     * does not.
     *
     * Layout:
     *   depth 0: |-------- Method (0-1000) --------|
     *   depth 1:       |-- DML (300-400) --|
     *
     * Expected: Buckets outside DML range should be Method (green).
     *           Bucket covering DML range should be DML (brown) due to weight.
     */
    const rects = [createRect('Method', 0, 1000, 0), createRect('DML', 300, 400, 1)];

    it('should show Method in buckets outside DML range', () => {
      // 10 buckets: each covers 100ns
      // Bucket 0 [0-100]: only Method → Method
      // Bucket 3 [300-400]: Method + DML → DML wins (2.5x weight)
      // Bucket 9 [900-1000]: only Method → Method
      const result = buildQuery(rects, 1000).query(10);

      // These buckets must be Method - the parent frame spans all of them
      expect(result.buckets[0]!.dominantCategory).toBe('Method');
      expect(result.buckets[1]!.dominantCategory).toBe('Method');
      expect(result.buckets[5]!.dominantCategory).toBe('Method');
      expect(result.buckets[9]!.dominantCategory).toBe('Method');

      // DML bucket: DML at depth 1 is deeper, with 2.5x weight
      expect(result.buckets[3]!.dominantCategory).toBe('DML');
    });

    it('counts every frame in each bucket it spans', () => {
      const result = buildQuery(rects, 1000).query(10);

      // The parent alone outside the child's range, both where they overlap.
      expect(result.buckets[0]!.eventCount).toBe(1);
      expect(result.buckets[3]!.eventCount).toBe(2);
      expect(result.buckets[9]!.eventCount).toBe(1);
    });
  });

  describe('multiple depth levels with overlapping frames', () => {
    /**
     * Layout:
     *   depth 0: |-------- Code Unit (0-1000) --------|
     *   depth 1: |-------- Method (0-1000) ------------|
     *   depth 2:       |-- SOQL (200-300) --|  |-- DML (600-700) --|
     *
     * Parent frames at several depths must all hold their own buckets, even with
     * short children between them.
     */
    it('should resolve Method where no SOQL/DML children exist', () => {
      const rects = [
        createRect('Code Unit', 0, 1000, 0),
        createRect('Method', 0, 1000, 1),
        createRect('SOQL', 200, 300, 2),
        createRect('DML', 600, 700, 2),
      ];

      const result = buildQuery(rects, 1000).query(10);

      // Bucket 0 [0-100]: Code Unit + Method → Method wins (deeper)
      expect(result.buckets[0]!.dominantCategory).toBe('Method');

      // Bucket 4 [400-500]: Code Unit + Method → Method wins (deeper)
      expect(result.buckets[4]!.dominantCategory).toBe('Method');

      // Bucket 2 [200-300]: Code Unit + Method + SOQL → SOQL wins (deepest + 2.5x weight)
      expect(result.buckets[2]!.dominantCategory).toBe('SOQL');

      // Bucket 6 [600-700]: Code Unit + Method + DML → DML wins (deepest + 2.5x weight)
      expect(result.buckets[6]!.dominantCategory).toBe('DML');
    });
  });

  it('recomputes only when the width changes', () => {
    const rects = [createRect('Method', 0, 1000, 0), createRect('DML', 300, 400, 1)];
    const query = buildQuery(rects, 1000);

    const first = query.query(10);
    expect(query.query(10)).toBe(first);

    // A different width is a different picture, so it cannot answer from the one held.
    const wider = query.query(11);
    expect(wider).not.toBe(first);

    // Only one is held, so the first width has to be computed again.
    expect(query.query(10)).not.toBe(first);
  });

  describe('edge cases', () => {
    it('should handle single frame spanning all buckets', () => {
      const rects = [createRect('Method', 0, 1000, 0)];
      const result = buildQuery(rects, 1000).query(5);

      for (const bucket of result.buckets) {
        expect(bucket.dominantCategory).toBe('Method');
      }
    });

    it('should handle empty timeline', () => {
      const result = buildQuery([], 0).query(10);
      expect(result.buckets).toHaveLength(0);
    });
  });

  describe('fractional bucket count (Windows fractional DPI scaling)', () => {
    // Regression: getBoundingClientRect().width is non-integer under Windows
    // 125%/150% display scaling; a fractional/NaN count previously threw
    // "Invalid array length" and aborted timeline init.
    const rects = [createRect('Method', 0, 1000, 0)];

    it('floors a fractional bucket count to the integer count', () => {
      // Two queries, not one: 10.6 and 10 floor to the same width, so a single
      // query would answer the second call from its cache and compare an object
      // with itself.
      const fractional = buildQuery(rects, 1000).query(10.6);
      const floored = buildQuery(rects, 1000).query(10);

      expect(fractional.buckets).toHaveLength(10);
      expect(fractional.buckets).toEqual(floored.buckets);

      // A real 150% DPI width.
      expect(buildQuery(rects, 1000).query(1536.6667).buckets).toHaveLength(1536);
    });

    it('treats a non-finite bucket count as empty instead of throwing', () => {
      const query = buildQuery(rects, 1000);

      expect(() => query.query(Number.NaN)).not.toThrow();
      expect(query.query(Number.NaN).buckets).toHaveLength(0);
    });
  });
});
