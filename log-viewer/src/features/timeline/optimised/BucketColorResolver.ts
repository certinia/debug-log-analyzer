/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Bucket Color Resolver
 *
 * Resolves the display color for a pixel bucket based on category statistics.
 * Uses priority order with duration and count tie-breakers.
 *
 * Priority order: DML > SOQL > Callout > Apex > Code Unit > System > Automation > Validation
 */

import type { CategoryStats } from '../types/flamechart.types.js';
import { BUCKET_CONSTANTS } from '../types/flamechart.types.js';

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
 * @param batchColors - Colors from RenderBatch (theme-aware category colors)
 * @returns Color and dominant category
 */
export function resolveColor(
  categoryStats: CategoryStats,
  batchColors: Map<string, BatchColorInfo>,
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

  const color = batchColors.get(winningCategory)?.color ?? UNKNOWN_CATEGORY_COLOR;

  return {
    color,
    dominantCategory: winningCategory,
  };
}
