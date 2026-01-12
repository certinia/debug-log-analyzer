/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Bucket Opacity Calculator
 *
 * Calculates opacity for pixel buckets based on event count.
 * Uses logarithmic scaling to show density visually.
 *
 * Formula: clamp(0.3 + 0.6 * log10(count) / log10(100), 0.3, 0.9)
 *
 * Visual effect:
 * - Sparse regions (1 event): faint (0.3 opacity)
 * - Dense regions (100+ events): prominent (0.9 opacity)
 * - Logarithmic scale makes intermediate densities visible
 */

import { BUCKET_CONSTANTS } from '../types/flamechart.types.js';

/**
 * Calculate bucket opacity based on event count.
 *
 * Uses logarithmic scaling so that:
 * - 1 event → 0.3 (minimum, faint)
 * - 10 events → 0.6 (medium visibility)
 * - 100 events → 0.9 (maximum, prominent)
 *
 * @param eventCount - Number of events in the bucket
 * @returns Opacity value between 0.3 and 0.9
 */
export function calculateOpacity(eventCount: number): number {
  const { MIN, MAX, RANGE, SATURATION_COUNT } = BUCKET_CONSTANTS.OPACITY;

  // Handle edge cases
  if (eventCount <= 1) {
    return MIN;
  }

  if (eventCount >= SATURATION_COUNT) {
    return MAX;
  }

  // Logarithmic scaling
  // Formula: MIN + RANGE * log10(count) / log10(SATURATION_COUNT)
  const logCount = Math.log10(eventCount);
  const logMax = Math.log10(SATURATION_COUNT);
  const normalizedLog = logCount / logMax;

  const opacity = MIN + RANGE * normalizedLog;

  // Clamp to valid range (should already be, but be safe)
  return Math.min(MAX, Math.max(MIN, opacity));
}
