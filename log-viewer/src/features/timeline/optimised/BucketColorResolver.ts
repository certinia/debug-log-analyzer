/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Bucket Color Resolver
 *
 * Resolves the display color for a pixel bucket based on category statistics.
 * Uses priority order with duration and count tie-breakers.
 *
 * Priority order: DML > SOQL > Method > Code Unit > System Method > Flow > Workflow
 */

import type { CategoryStats } from '../types/flamechart.types.js';
import { BUCKET_CONSTANTS } from '../types/flamechart.types.js';

/**
 * Map category names to their hex colors (numeric format).
 * Colors match TIMELINE_CONSTANTS.DEFAULT_COLORS but in numeric format.
 *
 * This is the single source of truth for category colors in numeric format.
 * All timeline code should use this via import or batchColors from theme.
 */
export const CATEGORY_COLORS: Record<string, number> = {
  DML: 0xb06868, // #B06868
  SOQL: 0x6d4c7d, // #6D4C7D
  Method: 0x2b8f81, // #2B8F81
  'Code Unit': 0x88ae58, // #88AE58
  'System Method': 0x8d6e63, // #8D6E63
  Flow: 0x5c8fa6, // #5C8FA6
  Workflow: 0x51a16e, // #51A16E
};

/**
 * Default gray color for unknown categories.
 */
export const UNKNOWN_CATEGORY_COLOR = 0x888888;

/**
 * Create a map of category name to priority index for fast lookup.
 * Lower index = higher priority.
 */
const PRIORITY_MAP = new Map<string, number>(
  BUCKET_CONSTANTS.CATEGORY_PRIORITY.map((cat, index) => [cat, index]),
);

/**
 * Result of color resolution including the dominant category.
 */
export interface ColorResolutionResult {
  /** Resolved hex color (0xRRGGBB) */
  color: number;
  /** The category that won the priority resolution */
  dominantCategory: string;
}

/**
 * Color info passed from RenderBatch (opaque colors only).
 */
export interface BatchColorInfo {
  color: number;
}

/**
 * Resolve the display color for a bucket from its category statistics.
 *
 * Algorithm:
 * 1. Find all known categories (those in CATEGORY_PRIORITY)
 * 2. Select by priority order (lower index = higher priority)
 * 3. Tie-break by total duration (higher duration wins)
 * 4. Tie-break by event count (higher count wins)
 *
 * @param categoryStats - Statistics for all categories in the bucket
 * @param batchColors - Optional colors from RenderBatch (for theme support)
 * @returns Color and dominant category
 */
export function resolveColor(
  categoryStats: CategoryStats,
  batchColors?: Map<string, BatchColorInfo>,
): ColorResolutionResult {
  const { byCategory } = categoryStats;

  if (byCategory.size === 0) {
    return {
      color: UNKNOWN_CATEGORY_COLOR,
      dominantCategory: '',
    };
  }

  // Find the winning category using priority, duration, and count
  let winningCategory = '';
  let winningPriority = Infinity;
  let winningDuration = -1;
  let winningCount = -1;

  for (const [category, stats] of byCategory) {
    const priority = PRIORITY_MAP.get(category) ?? Infinity;

    // Compare by priority first
    if (priority < winningPriority) {
      winningCategory = category;
      winningPriority = priority;
      winningDuration = stats.totalDuration;
      winningCount = stats.count;
    } else if (priority === winningPriority) {
      // Same priority: compare by duration
      if (stats.totalDuration > winningDuration) {
        winningCategory = category;
        winningDuration = stats.totalDuration;
        winningCount = stats.count;
      } else if (stats.totalDuration === winningDuration) {
        // Same duration: compare by count
        if (stats.count > winningCount) {
          winningCategory = category;
          winningCount = stats.count;
        }
      }
    }
  }

  // Get color for winning category (prefer batch colors for theme support)
  const color =
    batchColors?.get(winningCategory)?.color ??
    CATEGORY_COLORS[winningCategory] ??
    UNKNOWN_CATEGORY_COLOR;

  return {
    color,
    dominantCategory: winningCategory,
  };
}

// ============================================================================
// COLOR BLENDING UTILITIES
// ============================================================================

/**
 * Default dark theme background color for alpha blending.
 * This is the standard VS Code dark theme background.
 */
const DEFAULT_BACKGROUND_COLOR = 0x1e1e1e;

/**
 * Blend a color with a background color based on opacity.
 * Returns an opaque color that simulates the visual appearance of
 * the original color at the given opacity over the background.
 *
 * Formula: result = foreground * alpha + background * (1 - alpha)
 *
 * @param foregroundColor - The foreground color (0xRRGGBB)
 * @param opacity - Opacity value (0 to 1)
 * @param backgroundColor - Background color to blend against (default: dark theme background)
 * @returns Opaque blended color (0xRRGGBB)
 */
export function blendWithBackground(
  foregroundColor: number,
  opacity: number,
  backgroundColor: number = DEFAULT_BACKGROUND_COLOR,
): number {
  // Extract RGB components from foreground
  const fgR = (foregroundColor >> 16) & 0xff;
  const fgG = (foregroundColor >> 8) & 0xff;
  const fgB = foregroundColor & 0xff;

  // Extract RGB components from background
  const bgR = (backgroundColor >> 16) & 0xff;
  const bgG = (backgroundColor >> 8) & 0xff;
  const bgB = backgroundColor & 0xff;

  // Blend each channel: result = fg * alpha + bg * (1 - alpha)
  const invAlpha = 1 - opacity;
  const resultR = Math.round(fgR * opacity + bgR * invAlpha);
  const resultG = Math.round(fgG * opacity + bgG * invAlpha);
  const resultB = Math.round(fgB * opacity + bgB * invAlpha);

  // Combine back to a single color value
  return (resultR << 16) | (resultG << 8) | resultB;
}
