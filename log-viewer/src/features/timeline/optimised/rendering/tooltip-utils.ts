/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Shared tooltip utility functions and constants.
 *
 * Provides common helpers used by all tooltip implementations:
 * - FrameTooltipRenderer (event hover)
 * - MetricStripTooltipRenderer (governor limits)
 * - HeatStripTooltipRenderer (minimap metrics)
 */

import { formatInteger } from '../../../../core/utility/Util.js';

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
  background: 'var(--tl-hover-background, #252526)',
  /** Border color */
  border: 'var(--tl-hover-border, #454545)',
  /** Text color */
  foreground: 'var(--tl-hover-foreground, #e3e3e3)',
  /** Description/secondary text color */
  descriptionForeground: 'var(--tl-description-foreground, #999)',
  /** Muted description text color */
  descriptionForegroundMuted: 'var(--tl-description-foreground, #777)',
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
  return formatInteger(value);
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

/** How a reading names its denominator: `/` for a reported limit, `of` for the log's own peak. */
export type UsageSeparator = '/' | 'of';

/**
 * Format a reading against its denominator and an optional unit.
 *
 * @param used - Used value
 * @param denominator - Reported limit, or the metric's own peak in the log
 * @param unit - Optional unit string (e.g., "ms", "bytes")
 * @param separator - `/` reads as a cap the transaction was measured against, so a peak takes `of`
 * @returns Formatted string (e.g., "250 / 500 ms", "770 of 1,240")
 */
export function formatMetricValue(
  used: number,
  denominator: number,
  unit?: string,
  separator: UsageSeparator = '/',
): string {
  const usedStr = formatNumber(Math.round(used));
  const denominatorStr = formatNumber(Math.round(denominator));
  const reading = `${usedStr} ${separator} ${denominatorStr}`;
  return unit ? `${reading} ${unit}` : reading;
}

/** {@link formatMetricValue} in parentheses (e.g., "(250 / 500 ms)"). */
export function formatMetricValueWithParens(
  used: number,
  denominator: number,
  unit?: string,
  separator?: UsageSeparator,
): string {
  return `(${formatMetricValue(used, denominator, unit, separator)})`;
}
