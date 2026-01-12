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
 *
 * Performance: Uses pre-computed lookup table for O(1) access.
 */

import { BUCKET_CONSTANTS } from '../types/flamechart.types.js';
import { blendWithBackground } from './BucketColorResolver.js';

// Pre-computed opacity lookup table for event counts 0-100
// Avoids Math.log10() calls in hot render path
const OPACITY_LUT = buildOpacityLUT();

/**
 * Build pre-computed opacity lookup table.
 * Called once at module load time.
 */
function buildOpacityLUT(): number[] {
  const { MIN, MAX, RANGE, SATURATION_COUNT } = BUCKET_CONSTANTS.OPACITY;
  const lut: number[] = new Array(SATURATION_COUNT + 1);
  const logMax = Math.log10(SATURATION_COUNT);

  // Index 0 and 1: minimum opacity
  lut[0] = MIN;
  lut[1] = MIN;

  // Indexes 2 to SATURATION_COUNT-1: logarithmic scaling
  for (let i = 2; i < SATURATION_COUNT; i++) {
    const logCount = Math.log10(i);
    const normalizedLog = logCount / logMax;
    lut[i] = MIN + RANGE * normalizedLog;
  }

  // Index SATURATION_COUNT: explicitly set to MAX to avoid floating point error
  lut[SATURATION_COUNT] = MAX;

  return lut;
}

/**
 * Calculate bucket opacity based on event count.
 *
 * Uses logarithmic scaling so that:
 * - 1 event → 0.3 (minimum, faint)
 * - 10 events → 0.6 (medium visibility)
 * - 100 events → 0.9 (maximum, prominent)
 *
 * Performance: O(1) lookup from pre-computed table.
 *
 * @param eventCount - Number of events in the bucket
 * @returns Opacity value between 0.3 and 0.9
 */
export function calculateOpacity(eventCount: number): number {
  // Floor to handle fractional event counts (arrays use integer indices)
  const count = Math.floor(eventCount);

  // Fast path: use lookup table for common case (0-100 events)
  if (count <= BUCKET_CONSTANTS.OPACITY.SATURATION_COUNT) {
    return OPACITY_LUT[count] ?? BUCKET_CONSTANTS.OPACITY.MIN;
  }

  // Saturated: return max opacity
  return BUCKET_CONSTANTS.OPACITY.MAX;
}

/**
 * Calculate blended bucket color based on event count.
 *
 * Returns an opaque color that simulates the appearance of the source color
 * at density-based opacity, pre-blended with the background.
 * This avoids runtime alpha blending for better GPU performance.
 *
 * Uses logarithmic scaling for density visualization:
 * - 1 event → faint (mostly background)
 * - 10 events → medium visibility
 * - 100+ events → prominent (mostly source color)
 *
 * @param sourceColor - The source color (0xRRGGBB) from category resolution
 * @param eventCount - Number of events in the bucket
 * @param backgroundColor - Optional background color for blending (default: dark theme)
 * @returns Opaque blended color (0xRRGGBB)
 */
export function calculateBucketColor(
  sourceColor: number,
  eventCount: number,
  backgroundColor?: number,
): number {
  const opacity = calculateOpacity(eventCount);
  return blendWithBackground(sourceColor, opacity, backgroundColor);
}
