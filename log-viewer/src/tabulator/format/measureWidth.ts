/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { formatMs } from '../../core/utility/Duration.js';

// Deterministic estimate rather than canvas measurement: the webview cell font
// isn't reliably readable at build time, and under-measuring makes the column
// too narrow so its `bar + value + percent` content wraps instead of the table
// scrolling. A per-character estimate with padding is robust and close enough.
const CH_PX = 7.5; // ~tabular-nums UI font
const PADDING = 24; // cell padding + progress-bar allowance
const MIN_WIDTH = 110;

/**
 * Content width (px) for a duration + percent progress column, sized to its
 * widest value (`"<value> (100.00%)"` for the largest total). Scales with the
 * log's largest value and never under-sizes enough to wrap.
 */
export function progressColumnWidth(rootTotalNs: number): number {
  const chars = formatMs(rootTotalNs).length + ' (100.00%)'.length;
  return Math.max(MIN_WIDTH, Math.round(chars * CH_PX + PADDING));
}
