/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import type { CategoryAggregation, CategoryStats } from '../../types/flamechart.types.js';
import { resolveColor } from '../BucketColorResolver.js';

/**
 * Tests for BucketColorResolver - resolves bucket color from category statistics.
 *
 * Priority order: DML > SOQL > Callout > Apex > Code Unit > System > Automation > Validation
 * Tie-breakers: total duration → event count
 */

// Helper to create CategoryStats
function createCategoryStats(
  categories: Record<string, { count: number; totalDuration: number }>,
): CategoryStats {
  const byCategory = new Map<string, CategoryAggregation>();
  for (const [name, stats] of Object.entries(categories)) {
    byCategory.set(name, stats);
  }
  return {
    byCategory,
    dominantCategory: '', // Will be calculated by resolveColor
  };
}

describe('BucketColorResolver', () => {
  describe('priority order resolution', () => {
    it('should prioritize DML over all other categories', () => {
      const stats = createCategoryStats({
        DML: { count: 1, totalDuration: 100 },
        SOQL: { count: 10, totalDuration: 1000 },
        Apex: { count: 100, totalDuration: 10000 },
      });

      const result = resolveColor(stats);

      // DML color is #B06868 = 0xB06868
      expect(result.color).toBe(0xb06868);
      expect(result.dominantCategory).toBe('DML');
    });

    it('should prioritize SOQL over Apex, Code Unit, etc.', () => {
      const stats = createCategoryStats({
        SOQL: { count: 1, totalDuration: 100 },
        Apex: { count: 10, totalDuration: 1000 },
        'Code Unit': { count: 100, totalDuration: 10000 },
      });

      const result = resolveColor(stats);

      // SOQL color is #6D4C7D = 0x6D4C7D
      expect(result.color).toBe(0x6d4c7d);
      expect(result.dominantCategory).toBe('SOQL');
    });

    it('should prioritize Callout over Apex, Code Unit, System', () => {
      const stats = createCategoryStats({
        Callout: { count: 1, totalDuration: 100 },
        Apex: { count: 10, totalDuration: 1000 },
        System: { count: 100, totalDuration: 10000 },
      });

      const result = resolveColor(stats);

      // Callout color is #CCA033 = 0xCCA033
      expect(result.color).toBe(0xcca033);
      expect(result.dominantCategory).toBe('Callout');
    });

    it('should prioritize Apex over Code Unit, System, Automation', () => {
      const stats = createCategoryStats({
        Apex: { count: 1, totalDuration: 100 },
        'Code Unit': { count: 10, totalDuration: 1000 },
        System: { count: 100, totalDuration: 10000 },
      });

      const result = resolveColor(stats);

      // Apex color is #2B8F81 = 0x2B8F81
      expect(result.color).toBe(0x2b8f81);
      expect(result.dominantCategory).toBe('Apex');
    });

    it('should prioritize System over Automation', () => {
      const stats = createCategoryStats({
        System: { count: 1, totalDuration: 100 },
        Automation: { count: 10, totalDuration: 1000 },
      });

      const result = resolveColor(stats);

      // System color is #8D6E63 = 0x8D6E63
      expect(result.color).toBe(0x8d6e63);
      expect(result.dominantCategory).toBe('System');
    });

    it('should prioritize Automation over Validation', () => {
      const stats = createCategoryStats({
        Automation: { count: 1, totalDuration: 100 },
        Validation: { count: 10, totalDuration: 1000 },
      });

      const result = resolveColor(stats);

      // Automation color is #51A16E = 0x51A16E
      expect(result.color).toBe(0x51a16e);
      expect(result.dominantCategory).toBe('Automation');
    });

    it('should return Validation color when only Validation present', () => {
      const stats = createCategoryStats({
        Validation: { count: 5, totalDuration: 500 },
      });

      const result = resolveColor(stats);

      // Validation color is #546E7A = 0x546E7A
      expect(result.color).toBe(0x546e7a);
      expect(result.dominantCategory).toBe('Validation');
    });
  });

  describe('duration tie-breaking', () => {
    it('should use duration to break ties between same-priority categories', () => {
      const stats = createCategoryStats({
        Apex: { count: 5, totalDuration: 1000 },
      });

      const result = resolveColor(stats);
      expect(result.dominantCategory).toBe('Apex');
    });
  });

  describe('count tie-breaking', () => {
    it('should use count when priority and duration are equal', () => {
      const stats = createCategoryStats({
        DML: { count: 10, totalDuration: 500 },
      });

      const result = resolveColor(stats);
      expect(result.dominantCategory).toBe('DML');
    });
  });

  describe('unknown category handling', () => {
    it('should return gray color for unknown categories', () => {
      const stats = createCategoryStats({
        UnknownCategory: { count: 5, totalDuration: 500 },
      });

      const result = resolveColor(stats);

      // Gray fallback is #888888 = 0x888888
      expect(result.color).toBe(0x888888);
      expect(result.dominantCategory).toBe('UnknownCategory');
    });

    it('should prioritize known categories over unknown ones', () => {
      const stats = createCategoryStats({
        UnknownCategory: { count: 100, totalDuration: 10000 },
        Automation: { count: 1, totalDuration: 100 },
      });

      const result = resolveColor(stats);

      // Automation is known, so it should win over unknown
      expect(result.color).toBe(0x51a16e);
      expect(result.dominantCategory).toBe('Automation');
    });
  });

  describe('empty category stats', () => {
    it('should return gray color for empty category stats', () => {
      const stats: CategoryStats = {
        byCategory: new Map(),
        dominantCategory: '',
      };

      const result = resolveColor(stats);

      expect(result.color).toBe(0x888888);
      expect(result.dominantCategory).toBe('');
    });
  });
});
