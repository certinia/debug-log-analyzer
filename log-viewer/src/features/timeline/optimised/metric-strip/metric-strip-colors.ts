/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MetricStrip Color Definitions
 *
 * Universal colors for the governor limit metric strip visualization.
 * Colors are designed to be distinguishable on both light and dark backgrounds.
 */

import type { MarkerType } from '../../types/flamechart.types.js';

/**
 * MetricStrip color palette.
 */
export interface MetricStripColors {
  // Metric line colors (Big 4)
  soql: number;
  dml: number;
  cpu: number;
  heap: number;

  // Tier 3 aggregate line
  tier3: number;

  // Zone colors
  dangerZone: number; // 80-100% band
  limitLine: number; // 100% threshold
  breachArea: number; // >100% area fill

  // Grid and labels
  gridLine: number;
  labelText: number;

  // Area fill opacity (applied to line colors)
  areaFillOpacity: number;
}

/**
 * Universal colors for metric strip.
 * Vibrant colors that work on both light and dark backgrounds.
 */
export const METRIC_STRIP_COLORS: MetricStripColors = {
  // Metric line colors - vibrant, work on both backgrounds
  soql: 0xe64c4c, // Warm red
  dml: 0x00a3a3, // Teal
  cpu: 0xf5a623, // Amber/orange
  heap: 0x4ecdc4, // Mint teal

  // Tier 3 aggregate line (medium grey)
  tier3: 0x808080,

  // Zone colors
  dangerZone: 0xff9999, // Light red
  limitLine: 0xe64c4c, // Same warm red
  breachArea: 0x7c3aed, // Purple

  // Grid and labels - medium grey
  gridLine: 0x808080,
  labelText: 0x808080,

  // Area fill opacity
  areaFillOpacity: 0.15,
};

/**
 * Danger zone opacity (80-100% band).
 */
export const DANGER_ZONE_OPACITY = 0.15;

/**
 * Breach area opacity (>100%).
 */
export const BREACH_AREA_OPACITY = 0.25;

/**
 * MetricStrip height in pixels (expanded).
 */
export const METRIC_STRIP_HEIGHT = 80;

/**
 * MetricStrip height when collapsed in pixels.
 * Shows a compact heat-style visualization with expand icon.
 */
export const METRIC_STRIP_COLLAPSED_HEIGHT = 15;

/**
 * Gap between metric strip and main timeline in pixels.
 */
export const METRIC_STRIP_GAP = 4;

/**
 * Y-axis scale: 0% at bottom, 110% at top (100% line at ~91% height).
 * Provides 10% headroom above the 100% line for readability.
 */
export const METRIC_STRIP_Y_MAX_PERCENT = 1.1;

/**
 * Thresholds for danger zone and breach visualization.
 */
export const METRIC_STRIP_THRESHOLDS = {
  /** Safe zone (0-50%) - clear/transparent */
  safeEnd: 0.5,
  /** Warning zone start (50%) */
  warningStart: 0.5,
  /** Start of danger zone (80%) */
  dangerStart: 0.8,
  /** End of danger zone / start of breach (100%) */
  limit: 1.0,
} as const;

/**
 * Traffic light colors for collapsed heat-style visualization.
 * Based on the max percentage across all metrics in a time bucket.
 */
export const TRAFFIC_LIGHT_COLORS = {
  /** 0-50%: Safe zone - transparent/clear */
  safe: 0x00ff00, // Green (but typically rendered transparent)
  /** 50-80%: Warning zone - amber/orange */
  warning: 0xf59e0b,
  /** 80-100%: Critical zone - red */
  critical: 0xdc2626,
  /** >100%: Breach zone - purple */
  breach: 0x7c3aed,
} as const;

/**
 * Line widths for different tier levels.
 */
export const METRIC_STRIP_LINE_WIDTHS = {
  /** Tier 1 and 2 metrics (solid lines) */
  primary: 2,
  /** Tier 3 aggregate (dashed line) */
  tier3: 1.5,
  /** 100% limit line */
  limit: 1,
  /** Grid lines */
  grid: 1,
} as const;

/**
 * Rank-based colors for Tier 1 metrics (top 3 by usage).
 * These are assigned by rank position, not by metric type.
 * Index 0 = highest usage metric, Index 1 = second highest, etc.
 * Universal colors that work on both light and dark backgrounds.
 */
export const TIER_1_COLORS: readonly number[] = [
  0xe64c4c, // Warm red - most prominent
  0xf5a623, // Amber - second
  0x00a3a3, // Teal - third
] as const;

/**
 * Rank-based colors for Tier 2 metrics (auto-promoted due to >80% usage).
 * These wrap if more than available colors.
 * Universal colors that work on both light and dark backgrounds.
 */
export const TIER_2_COLORS: readonly number[] = [
  0x4ecdc4, // Mint teal
  0xf59e0b, // Amber
  0x8b5cf6, // Purple
  0x3b82f6, // Blue
  0xec4899, // Pink
  0x14b8a6, // Teal
] as const;

/**
 * Get color for a metric based on its rank within a tier.
 *
 * @param tier - The tier (1, 2, or 3)
 * @param rankInTier - The rank within the tier (0-indexed)
 * @returns Color for the metric
 */
export function getRankBasedColor(tier: 1 | 2 | 3, rankInTier: number): number {
  if (tier === 1) {
    return TIER_1_COLORS[rankInTier % TIER_1_COLORS.length]!;
  } else if (tier === 2) {
    return TIER_2_COLORS[rankInTier % TIER_2_COLORS.length]!;
  } else {
    // Tier 3 always gets grey
    return METRIC_STRIP_COLORS.tier3;
  }
}

/**
 * Get metric strip colors.
 *
 * @returns Color palette
 */
export function getMetricStripColors(): MetricStripColors {
  return METRIC_STRIP_COLORS;
}

/**
 * Traffic light color result with color and alpha.
 */
export interface TrafficLightColor {
  color: number;
  alpha: number;
}

/**
 * Get traffic light color and alpha for a given percentage.
 * Uses METRIC_STRIP_THRESHOLDS for consistent threshold values.
 *
 * @param percent - Percentage value (0-1+)
 * @returns Color and alpha for the percentage level
 *
 * Thresholds:
 * - 0-50%: transparent (safe)
 * - 50-80%: amber (warning)
 * - 80-100%: red (critical)
 * - >100%: purple (breach)
 */
export function getTrafficLightColor(percent: number): TrafficLightColor {
  if (percent > METRIC_STRIP_THRESHOLDS.limit) {
    return { color: TRAFFIC_LIGHT_COLORS.breach, alpha: 0.7 };
  } else if (percent >= METRIC_STRIP_THRESHOLDS.dangerStart) {
    return { color: TRAFFIC_LIGHT_COLORS.critical, alpha: 0.7 };
  } else if (percent >= METRIC_STRIP_THRESHOLDS.warningStart) {
    return { color: TRAFFIC_LIGHT_COLORS.warning, alpha: 0.7 };
  } else {
    return { color: 0x000000, alpha: 0 };
  }
}

/**
 * Default metric color mapping for Apex governor limits.
 * Maps metric IDs to their assigned colors.
 * @deprecated Use getRankBasedColor() for rank-based coloring instead
 */
export const APEX_METRIC_COLORS: Record<string, number> = {
  cpuTime: METRIC_STRIP_COLORS.cpu,
  soqlQueries: METRIC_STRIP_COLORS.soql,
  dmlStatements: METRIC_STRIP_COLORS.dml,
  heapSize: METRIC_STRIP_COLORS.heap,
  // Additional colors for Tier 2-eligible metrics
  queryRows: 0xf59e0b, // Amber
  dmlRows: 0x8b5cf6, // Purple
  soslQueries: 0x3b82f6, // Blue
  callouts: 0xec4899, // Pink
  futureCalls: 0x14b8a6, // Teal
};

/**
 * Get metric color for a specific metric ID.
 *
 * @param metricId - The metric identifier
 * @returns Color for the metric, or tier3 color as fallback
 */
export function getMetricColor(metricId: string): number {
  return APEX_METRIC_COLORS[metricId] ?? METRIC_STRIP_COLORS.tier3;
}

/**
 * Time grid line color for vertical tick marks.
 * Matches the main timeline axis grid color.
 */
export const METRIC_STRIP_TIME_GRID_COLOR = 0x808080;

/**
 * Time grid line opacity.
 */
export const METRIC_STRIP_TIME_GRID_OPACITY = 0.3;

/**
 * Marker colors pre-blended with background for metric strip background bands.
 * These match the minimap marker colors for visual consistency.
 */
export const METRIC_STRIP_MARKER_COLORS_BLENDED: Record<MarkerType, number> = {
  error: 0xff8080, // Light red
  skip: 0x1e80ff, // Light blue
  unexpected: 0x8080ff, // Light purple
};

/**
 * Marker band opacity in metric strip.
 * Matches MARKER_ALPHA (0.2) from main timeline for visual consistency.
 */
export const METRIC_STRIP_MARKER_OPACITY = 0.2;

/**
 * Width of the expand/collapse toggle area on the left side.
 */
export const METRIC_STRIP_TOGGLE_WIDTH = 20;

/**
 * Toggle button colors.
 */
export const METRIC_STRIP_TOGGLE_COLORS = {
  /** Background when not hovered. */
  background: 0x333333,
  /** Background when hovered. */
  backgroundHover: 0x444444,
  /** Chevron icon color. */
  icon: 0xcccccc,
  /** Chevron icon color when hovered. */
  iconHover: 0xffffff,
} as const;
