/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MetricStrip Color Definitions
 *
 * Light and dark theme colors for the governor limit metric strip visualization.
 * Colors are designed to be distinguishable in both themes while maintaining
 * visual consistency with the overall timeline design.
 */

/**
 * MetricStrip color palette for a specific theme.
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
 * Dark theme colors for metric strip.
 * Optimized for visibility on dark backgrounds.
 */
export const METRIC_STRIP_COLORS_DARK: MetricStripColors = {
  // Metric line colors (vibrant for dark backgrounds)
  soql: 0xff6b6b, // Coral red
  dml: 0x4ecdc4, // Teal
  cpu: 0xffe66d, // Yellow
  heap: 0x95e1d3, // Mint green

  // Tier 3 aggregate line (subtle grey)
  tier3: 0x666666,

  // Zone colors
  dangerZone: 0xff9999, // Light red with low alpha
  limitLine: 0xff3333, // Bright red
  breachArea: 0x7c3aed, // Purple

  // Grid and labels
  gridLine: 0x444444,
  labelText: 0x999999,

  // Area fill opacity
  areaFillOpacity: 0.15,
};

/**
 * Light theme colors for metric strip.
 * Optimized for visibility on light backgrounds.
 */
export const METRIC_STRIP_COLORS_LIGHT: MetricStripColors = {
  // Metric line colors (darker for light backgrounds)
  soql: 0xcc0000, // Dark red
  dml: 0x008080, // Dark teal
  cpu: 0xff9900, // Orange
  heap: 0x00cc99, // Dark mint

  // Tier 3 aggregate line (medium grey)
  tier3: 0x999999,

  // Zone colors
  dangerZone: 0xffcccc, // Light red with low alpha
  limitLine: 0xcc0000, // Dark red
  breachArea: 0x7c3aed, // Purple (same in both themes)

  // Grid and labels
  gridLine: 0xcccccc,
  labelText: 0x666666,

  // Area fill opacity
  areaFillOpacity: 0.12,
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
 */
export const TIER_1_COLORS_DARK: readonly number[] = [
  0xff6b6b, // Coral red - most prominent
  0xffe66d, // Yellow - second
  0x4ecdc4, // Teal - third
] as const;

export const TIER_1_COLORS_LIGHT: readonly number[] = [
  0xcc0000, // Dark red - most prominent
  0xff9900, // Orange - second
  0x008080, // Dark teal - third
] as const;

/**
 * Rank-based colors for Tier 2 metrics (auto-promoted due to >80% usage).
 * These wrap if more than available colors.
 */
export const TIER_2_COLORS_DARK: readonly number[] = [
  0x95e1d3, // Mint green
  0xffa500, // Orange
  0x9b59b6, // Purple
  0x3498db, // Blue
  0xe91e63, // Pink
  0x00bcd4, // Cyan
] as const;

export const TIER_2_COLORS_LIGHT: readonly number[] = [
  0x00cc99, // Dark mint
  0xcc7000, // Dark orange
  0x7b2d8e, // Dark purple
  0x2070a0, // Dark blue
  0xb0164a, // Dark pink
  0x008090, // Dark cyan
] as const;

/**
 * Get color for a metric based on its rank within a tier.
 *
 * @param tier - The tier (1, 2, or 3)
 * @param rankInTier - The rank within the tier (0-indexed)
 * @param isDarkTheme - Whether dark theme is active
 * @returns Color for the metric
 */
export function getRankBasedColor(
  tier: 1 | 2 | 3,
  rankInTier: number,
  isDarkTheme: boolean,
): number {
  if (tier === 1) {
    const colors = isDarkTheme ? TIER_1_COLORS_DARK : TIER_1_COLORS_LIGHT;
    return colors[rankInTier % colors.length]!;
  } else if (tier === 2) {
    const colors = isDarkTheme ? TIER_2_COLORS_DARK : TIER_2_COLORS_LIGHT;
    return colors[rankInTier % colors.length]!;
  } else {
    // Tier 3 always gets grey
    return isDarkTheme ? METRIC_STRIP_COLORS_DARK.tier3 : METRIC_STRIP_COLORS_LIGHT.tier3;
  }
}

/**
 * Get metric strip colors for the current theme.
 *
 * @param isDarkTheme - Whether dark theme is active
 * @returns Color palette for the theme
 */
export function getMetricStripColors(isDarkTheme: boolean): MetricStripColors {
  return isDarkTheme ? METRIC_STRIP_COLORS_DARK : METRIC_STRIP_COLORS_LIGHT;
}

/**
 * Default metric color mapping for Apex governor limits.
 * Maps metric IDs to their assigned colors.
 * @deprecated Use getRankBasedColor() for rank-based coloring instead
 */
export const APEX_METRIC_COLORS_DARK: Record<string, number> = {
  cpuTime: METRIC_STRIP_COLORS_DARK.cpu,
  soqlQueries: METRIC_STRIP_COLORS_DARK.soql,
  dmlStatements: METRIC_STRIP_COLORS_DARK.dml,
  heapSize: METRIC_STRIP_COLORS_DARK.heap,
  // Additional colors for Tier 2-eligible metrics
  queryRows: 0xffa500, // Orange
  dmlRows: 0x9b59b6, // Purple
  soslQueries: 0x3498db, // Blue
  callouts: 0xe91e63, // Pink
  futureCalls: 0x00bcd4, // Cyan
};

export const APEX_METRIC_COLORS_LIGHT: Record<string, number> = {
  cpuTime: METRIC_STRIP_COLORS_LIGHT.cpu,
  soqlQueries: METRIC_STRIP_COLORS_LIGHT.soql,
  dmlStatements: METRIC_STRIP_COLORS_LIGHT.dml,
  heapSize: METRIC_STRIP_COLORS_LIGHT.heap,
  // Additional colors for Tier 2-eligible metrics
  queryRows: 0xcc7000, // Dark orange
  dmlRows: 0x7b2d8e, // Dark purple
  soslQueries: 0x2070a0, // Dark blue
  callouts: 0xb0164a, // Dark pink
  futureCalls: 0x008090, // Dark cyan
};

/**
 * Get metric color for a specific metric ID.
 *
 * @param metricId - The metric identifier
 * @param isDarkTheme - Whether dark theme is active
 * @returns Color for the metric, or tier3 color as fallback
 */
export function getMetricColor(metricId: string, isDarkTheme: boolean): number {
  const colors = isDarkTheme ? APEX_METRIC_COLORS_DARK : APEX_METRIC_COLORS_LIGHT;
  const fallback = isDarkTheme ? METRIC_STRIP_COLORS_DARK.tier3 : METRIC_STRIP_COLORS_LIGHT.tier3;
  return colors[metricId] ?? fallback;
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
export const METRIC_STRIP_MARKER_COLORS_BLENDED: Record<string, number> = {
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
