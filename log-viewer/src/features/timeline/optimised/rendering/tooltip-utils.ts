/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Shared tooltip utility functions and constants.
 *
 * Provides common helpers used by all tooltip implementations:
 * - TimelineTooltipManager (event hover)
 * - MetricStripTooltipRenderer (governor limits)
 * - HeatStripTooltipRenderer (minimap metrics)
 */

// ============================================================================
// TRAFFIC LIGHT THRESHOLDS
// ============================================================================

/**
 * Threshold for critical percentage (red zone).
 */
export const PERCENT_THRESHOLD_CRITICAL = 0.8;

/**
 * Threshold for warning percentage (amber zone).
 */
export const PERCENT_THRESHOLD_WARNING = 0.5;

/**
 * Threshold for breach (purple zone).
 */
export const PERCENT_THRESHOLD_BREACH = 1.0;

// ============================================================================
// TOOLTIP CSS CONSTANTS
// ============================================================================

/**
 * Common tooltip CSS properties using VS Code theme variables.
 */
export const TOOLTIP_CSS = {
  /** Background color */
  background: 'var(--vscode-editorWidget-background, #252526)',
  /** Border color */
  border: 'var(--vscode-editorWidget-border, #454545)',
  /** Text color */
  foreground: 'var(--vscode-editorWidget-foreground, #e3e3e3)',
  /** Description/secondary text color */
  descriptionForeground: 'var(--vscode-descriptionForeground, #999)',
  /** Muted description text color */
  descriptionForegroundMuted: 'var(--vscode-descriptionForeground, #777)',
} as const;

// ============================================================================
// TRAFFIC LIGHT COLORS
// ============================================================================

/**
 * Traffic light colors for percentage visualization.
 */
export const PERCENT_COLORS = {
  /** Purple - breached (>100%) */
  breach: '#7c3aed',
  /** Red - critical (>80%) */
  critical: '#dc2626',
  /** Amber - warning (>50%) */
  warning: '#f59e0b',
  /** Green - safe (<50%) */
  safe: '#10b981',
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format a number with thousands separators.
 *
 * @param value - Number to format
 * @returns Formatted string with locale-specific thousands separators
 */
export function formatNumber(value: number): string {
  return value.toLocaleString();
}

/**
 * Get CSS color for percentage value using traffic light system.
 *
 * - Purple: >100% (breached)
 * - Red: >80% (critical)
 * - Amber: >50% (warning)
 * - Green: <50% (safe)
 *
 * @param percent - Percentage as decimal (0.8 = 80%)
 * @returns CSS color string
 */
export function getPercentColor(percent: number): string {
  if (percent >= PERCENT_THRESHOLD_BREACH) {
    return PERCENT_COLORS.breach;
  } else if (percent >= PERCENT_THRESHOLD_CRITICAL) {
    return PERCENT_COLORS.critical;
  } else if (percent >= PERCENT_THRESHOLD_WARNING) {
    return PERCENT_COLORS.warning;
  }
  return PERCENT_COLORS.safe;
}

/**
 * Convert numeric hex color to CSS hex string.
 *
 * @param hex - Numeric color (e.g., 0xff6b6b)
 * @returns CSS hex string (e.g., "#ff6b6b")
 */
export function hexToCSS(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * Format metric value with used/limit and optional unit.
 *
 * @param used - Used value
 * @param limit - Limit value
 * @param unit - Optional unit string (e.g., "ms", "bytes")
 * @returns Formatted string (e.g., "250 / 500 ms")
 */
export function formatMetricValue(used: number, limit: number, unit?: string): string {
  const usedStr = formatNumber(Math.round(used));
  const limitStr = formatNumber(Math.round(limit));
  if (unit) {
    return `${usedStr} / ${limitStr} ${unit}`;
  }
  return `${usedStr} / ${limitStr}`;
}

/**
 * Format metric value with parentheses.
 *
 * @param used - Used value
 * @param limit - Limit value
 * @param unit - Optional unit string
 * @returns Formatted string with parentheses (e.g., "(250 / 500 ms)")
 */
export function formatMetricValueWithParens(used: number, limit: number, unit?: string): string {
  return `(${formatMetricValue(used, limit, unit)})`;
}
