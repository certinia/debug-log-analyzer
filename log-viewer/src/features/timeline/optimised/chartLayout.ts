/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { TIMELINE_CONSTANTS } from '../types/flamechart.types.js';
import {
  METRIC_STRIP_COLLAPSED_HEIGHT,
  METRIC_STRIP_GAP,
} from './metric-strip/metric-strip-colors.js';
import { calculateMinimapHeight, MINIMAP_GAP } from './minimap/MinimapViewport.js';

/** Height above the main chart: the minimap, and the metric strip when it shows (0 when hidden). */
export function chartOverheadHeight(minimapHeight: number, metricStripHeight: number): number {
  return (
    minimapHeight + MINIMAP_GAP + (metricStripHeight ? metricStripHeight + METRIC_STRIP_GAP : 0)
  );
}

/** The smallest container the chart draws in: the overhead at its smallest, plus two rows. */
export const MIN_CHART_HEIGHT =
  chartOverheadHeight(calculateMinimapHeight(0), METRIC_STRIP_COLLAPSED_HEIGHT) +
  TIMELINE_CONSTANTS.EVENT_HEIGHT * 2;
