/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import { BUCKET_CONSTANTS } from '../../types/flamechart.types.js';
import { calculateOpacity } from '../BucketOpacity.js';

/**
 * Tests for BucketOpacity - calculates opacity based on event count.
 *
 * Formula: clamp(0.3 + 0.6 * log10(count) / log10(100), 0.3, 0.9)
 *
 * Visual representation:
 * - 1 event:     opacity 0.3 (minimum)
 * - 10 events:   opacity ~0.6
 * - 50 events:   opacity ~0.81
 * - 100+ events: opacity 0.9 (saturated/maximum)
 */

describe('BucketOpacity', () => {
  describe('single event', () => {
    it('should return minimum opacity (0.3) for 1 event', () => {
      const opacity = calculateOpacity(1);

      expect(opacity).toBe(BUCKET_CONSTANTS.OPACITY.MIN);
      expect(opacity).toBe(0.3);
    });

    it('should return minimum opacity (0.3) for 0 events', () => {
      const opacity = calculateOpacity(0);

      // 0 events should clamp to minimum
      expect(opacity).toBe(0.3);
    });
  });

  describe('saturation at 100+ events', () => {
    it('should return maximum opacity (0.9) for exactly 100 events', () => {
      const opacity = calculateOpacity(100);

      expect(opacity).toBe(BUCKET_CONSTANTS.OPACITY.MAX);
      expect(opacity).toBe(0.9);
    });

    it('should return maximum opacity (0.9) for more than 100 events', () => {
      const opacity = calculateOpacity(150);
      expect(opacity).toBe(0.9);

      const opacity500 = calculateOpacity(500);
      expect(opacity500).toBe(0.9);

      const opacity1000 = calculateOpacity(1000);
      expect(opacity1000).toBe(0.9);
    });
  });

  describe('logarithmic scaling', () => {
    it('should return approximately 0.6 for 10 events', () => {
      // Formula: 0.3 + 0.6 * log10(10) / log10(100)
      //        = 0.3 + 0.6 * 1 / 2
      //        = 0.3 + 0.3
      //        = 0.6
      const opacity = calculateOpacity(10);

      expect(opacity).toBeCloseTo(0.6, 2);
    });

    it('should return approximately 0.81 for 50 events', () => {
      // Formula: 0.3 + 0.6 * log10(50) / log10(100)
      //        = 0.3 + 0.6 * 1.699 / 2
      //        = 0.3 + 0.6 * 0.8495
      //        = 0.3 + 0.5097
      //        ≈ 0.81
      const opacity = calculateOpacity(50);

      expect(opacity).toBeCloseTo(0.81, 1);
    });

    it('should show logarithmic progression (not linear)', () => {
      const opacity1 = calculateOpacity(1);
      const opacity10 = calculateOpacity(10);
      const opacity50 = calculateOpacity(50);
      const opacity100 = calculateOpacity(100);

      // Verify logarithmic: gap from 1→10 should be smaller than 10→100
      // but gap from 10→50 should be larger than 50→100
      expect(opacity10 - opacity1).toBeCloseTo(0.3, 2); // 0.6 - 0.3 = 0.3
      expect(opacity100 - opacity10).toBeCloseTo(0.3, 2); // 0.9 - 0.6 = 0.3

      // The jump from 50 to 100 is smaller than 10 to 50
      expect(opacity50 - opacity10).toBeGreaterThan(opacity100 - opacity50);
    });

    it('should handle small event counts (2-9)', () => {
      // All should be between 0.3 and 0.6
      for (let count = 2; count < 10; count++) {
        const opacity = calculateOpacity(count);
        expect(opacity).toBeGreaterThan(0.3);
        expect(opacity).toBeLessThan(0.6);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle negative event counts by clamping to minimum', () => {
      const opacity = calculateOpacity(-5);
      expect(opacity).toBe(0.3);
    });

    it('should handle very large event counts', () => {
      const opacity = calculateOpacity(1_000_000);
      expect(opacity).toBe(0.9);
    });

    it('should handle fractional event counts', () => {
      // Though unusual, should still work
      const opacity = calculateOpacity(5.5);
      expect(opacity).toBeGreaterThan(0.3);
      expect(opacity).toBeLessThan(0.9);
    });
  });
});
