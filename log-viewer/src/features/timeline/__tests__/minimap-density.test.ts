/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for MinimapDensityQuery
 *
 * Tests category resolution for minimap coloring, ensuring:
 * - Long-spanning parent frames are not skipped during frame collection
 * - Skyline (on-top time) algorithm correctly identifies dominant category
 * - Both fallback and segment tree paths produce consistent results
 */

import type { LogEvent } from 'apex-log-parser';
import { MinimapDensityQuery } from '../optimised/minimap/MinimapDensityQuery.js';
import type { PrecomputedRect } from '../optimised/RectangleManager.js';
import { TemporalSegmentTree } from '../optimised/TemporalSegmentTree.js';

/**
 * Helper to create a mock PrecomputedRect.
 */
function createRect(
  category: string,
  timeStart: number,
  timeEnd: number,
  depth: number,
  selfDuration?: number,
): PrecomputedRect {
  const duration = timeEnd - timeStart;
  return {
    id: `${category}-${timeStart}-${depth}`,
    timeStart,
    timeEnd,
    depth,
    duration,
    selfDuration: selfDuration ?? duration,
    category,
    x: 0,
    y: 0,
    width: 0,
    height: 20,
    eventRef: { timestamp: timeStart } as LogEvent,
  };
}

/**
 * Build rectsByCategory from a flat list of rects.
 */
function buildRectsByCategory(rects: PrecomputedRect[]): Map<string, PrecomputedRect[]> {
  const map = new Map<string, PrecomputedRect[]>();
  for (const rect of rects) {
    let arr = map.get(rect.category);
    if (!arr) {
      arr = [];
      map.set(rect.category, arr);
    }
    arr.push(rect);
  }
  return map;
}

describe('MinimapDensityQuery', () => {
  describe('category resolution with long-spanning parent frames', () => {
    /**
     * Regression test: A long parent Method frame spanning many buckets
     * with a short DML child in the middle.
     *
     * The parent Method frame must be included in all overlapping buckets
     * for correct skyline computation. If frames are collected via binary
     * search on timeEnd (with timeStart-sorted data), long-spanning parent
     * frames can be skipped, causing incorrect coloring.
     *
     * Layout:
     *   depth 0: |-------- Method (0-1000) --------|
     *   depth 1:       |-- DML (300-400) --|
     *
     * Expected: Buckets outside DML range should be Method (green).
     *           Bucket covering DML range should be DML (brown) due to weight.
     */
    const rects = [
      createRect('Method', 0, 1000, 0, 600), // parent, selfDuration excludes DML child time
      createRect('DML', 300, 400, 1, 100),
    ];

    it('should show Method in buckets outside DML range (fallback path)', () => {
      const rectsByCategory = buildRectsByCategory(rects);
      const query = new MinimapDensityQuery(rectsByCategory, 1000, 1);

      // 10 buckets: each covers 100ns
      // Bucket 0 [0-100]: only Method → Method
      // Bucket 3 [300-400]: Method + DML → DML wins (2.5x weight)
      // Bucket 9 [900-1000]: only Method → Method
      const result = query.query(10);

      expect(result.buckets[0]!.dominantCategory).toBe('Method');
      expect(result.buckets[1]!.dominantCategory).toBe('Method');
      expect(result.buckets[9]!.dominantCategory).toBe('Method');

      // DML bucket: DML at depth 1 is deeper, with 2.5x weight
      expect(result.buckets[3]!.dominantCategory).toBe('DML');
    });

    it('should show Method in buckets outside DML range (segment tree path)', () => {
      const rectsByCategory = buildRectsByCategory(rects);
      const segmentTree = new TemporalSegmentTree(rectsByCategory);
      const query = new MinimapDensityQuery(rectsByCategory, 1000, 1, segmentTree);

      const result = query.query(10);

      // These buckets must be Method - the parent frame spans all of them
      expect(result.buckets[0]!.dominantCategory).toBe('Method');
      expect(result.buckets[1]!.dominantCategory).toBe('Method');
      expect(result.buckets[5]!.dominantCategory).toBe('Method');
      expect(result.buckets[9]!.dominantCategory).toBe('Method');

      // DML bucket
      expect(result.buckets[3]!.dominantCategory).toBe('DML');
    });

    it('should produce consistent results between fallback and segment tree paths', () => {
      const rectsByCategory = buildRectsByCategory(rects);
      const segmentTree = new TemporalSegmentTree(rectsByCategory);

      const fallbackQuery = new MinimapDensityQuery(rectsByCategory, 1000, 1);
      const treeQuery = new MinimapDensityQuery(rectsByCategory, 1000, 1, segmentTree);

      const fallbackResult = fallbackQuery.query(10);
      const treeResult = treeQuery.query(10);

      for (let i = 0; i < 10; i++) {
        expect(treeResult.buckets[i]!.dominantCategory).toBe(
          fallbackResult.buckets[i]!.dominantCategory,
        );
      }
    });
  });

  describe('multiple depth levels with overlapping frames', () => {
    /**
     * Layout:
     *   depth 0: |-------- Code Unit (0-1000) --------|
     *   depth 1: |-------- Method (0-1000) ------------|
     *   depth 2:       |-- SOQL (200-300) --|  |-- DML (600-700) --|
     *
     * This tests that parent frames at multiple depths are all correctly
     * collected even when short children exist between them.
     */
    it('should resolve Method where no SOQL/DML children exist', () => {
      const rects = [
        createRect('Code Unit', 0, 1000, 0, 0), // code unit has 0 self duration (all children)
        createRect('Method', 0, 1000, 1, 800), // method covers most of the time
        createRect('SOQL', 200, 300, 2, 100),
        createRect('DML', 600, 700, 2, 100),
      ];

      const rectsByCategory = buildRectsByCategory(rects);
      const segmentTree = new TemporalSegmentTree(rectsByCategory);
      const query = new MinimapDensityQuery(rectsByCategory, 1000, 2, segmentTree);

      const result = query.query(10);

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

  describe('edge cases', () => {
    it('should handle single frame spanning all buckets', () => {
      const rects = [createRect('Method', 0, 1000, 0)];
      const rectsByCategory = buildRectsByCategory(rects);
      const segmentTree = new TemporalSegmentTree(rectsByCategory);
      const query = new MinimapDensityQuery(rectsByCategory, 1000, 0, segmentTree);

      const result = query.query(5);

      for (const bucket of result.buckets) {
        expect(bucket.dominantCategory).toBe('Method');
      }
    });

    it('should handle empty timeline', () => {
      const rectsByCategory = new Map<string, PrecomputedRect[]>();
      const query = new MinimapDensityQuery(rectsByCategory, 0, 0);

      const result = query.query(10);
      expect(result.buckets).toHaveLength(0);
    });
  });
});
