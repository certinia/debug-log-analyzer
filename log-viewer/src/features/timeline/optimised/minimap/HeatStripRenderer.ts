/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * HeatStripRenderer
 *
 * Renders a 5px heat strip at the bottom of the minimap showing metric
 * usage over time using a traffic light color system.
 *
 * This is a generic renderer that works with any metric system via HeatStripTimeSeries.
 * Apex-specific details (metric names, units, priorities) are defined in ApexLogTimeline.
 *
 * Visual design:
 * - Position: Bottom edge of minimap container
 * - Height: 5px fixed
 * - Width: Full minimap width (matches time axis)
 * - Colors: Traffic light system (transparent < 50%, amber 50-80%, red 80-100%, purple > 100%)
 *
 * Performance:
 * - Aggregates at each timestamp displaying the MAX percentage across ALL metrics
 * - Part of minimap's static content (only redrawn on data change)
 * - Uses PIXI.Graphics for filled rectangles
 */

import { Graphics } from 'pixi.js';
import type { HeatStripMetric, HeatStripTimeSeries } from '../../types/flamechart.types.js';
import type { MinimapManager } from './MinimapManager.js';

/**
 * Heat strip visual height in pixels.
 */
export const HEAT_STRIP_HEIGHT = 5;

/**
 * Heat strip interaction hit area height in pixels.
 * Larger than visual height for easier mouse targeting.
 */
export const HEAT_STRIP_HIT_HEIGHT = 12;

/**
 * Color thresholds for traffic light system.
 */
const THRESHOLD_WARNING = 0.5; // 50%
const THRESHOLD_CRITICAL = 0.8; // 80%
const THRESHOLD_BREACH = 1.0; // 100%

/**
 * Traffic light colors.
 */
const COLOR_WARNING = 0xf59e0b; // Amber
const COLOR_CRITICAL = 0xdc2626; // Red
const COLOR_BREACH = 0x7c3aed; // Purple

/**
 * Opacity for heat strip rectangles.
 */
const HEAT_STRIP_OPACITY = 1.0;

/**
 * Snapshot of a metric at a point in time (for tooltip).
 */
export interface MetricSnapshot {
  /** Usage as fraction (0-1+) */
  percent: number;
  /** Current usage value */
  used: number;
  /** Maximum limit value */
  limit: number;
}

/**
 * Aggregated metric data at a point in time.
 */
export interface HeatStripDataPoint {
  /** Timestamp in nanoseconds. */
  timestamp: number;
  /** Maximum percentage across all metrics at this timestamp (0-1+). */
  maxPercent: number;
  /** Individual metric snapshots for tooltip (metric id → snapshot). */
  metricSnapshots: Map<string, MetricSnapshot>;
}

/**
 * Processed heat strip data ready for rendering.
 */
export interface HeatStripData {
  /** Data points ordered by timestamp. */
  points: HeatStripDataPoint[];
  /** Whether there's any data to render. */
  hasData: boolean;
  /** Metric definitions for tooltip formatting. */
  metrics: Map<string, HeatStripMetric>;
}

export class HeatStripRenderer {
  /** Graphics object for heat strip rectangles. */
  private graphics: Graphics;

  /** Cached heat strip data. */
  private cachedData: HeatStripData | null = null;

  constructor() {
    this.graphics = new Graphics();
  }

  /**
   * Get the graphics object for adding to a parent container.
   */
  public getGraphics(): Graphics {
    return this.graphics;
  }

  /**
   * Process time series data into heat strip format.
   * Call this when data changes (e.g., new log loaded).
   *
   * Multiple namespace events can exist at the same timestamp - we aggregate
   * by summing `used` values across namespaces (limits are global, not per-namespace).
   *
   * @param timeSeries - Generic heat strip time series data
   * @returns Processed heat strip data
   */
  public processData(timeSeries: HeatStripTimeSeries): HeatStripData {
    // Group events by timestamp, aggregating used values across namespaces
    const aggregatedByTime = new Map<number, Map<string, { used: number; limit: number }>>();

    for (const event of timeSeries.events) {
      let timestampData = aggregatedByTime.get(event.timestamp);
      if (!timestampData) {
        timestampData = new Map();
        aggregatedByTime.set(event.timestamp, timestampData);
      }

      // Sum used values across namespaces for each metric
      for (const [metricId, value] of event.values) {
        const existing = timestampData.get(metricId);
        if (existing) {
          // Sum used values, keep the same limit (it's global)
          existing.used += value.used;
        } else {
          timestampData.set(metricId, { used: value.used, limit: value.limit });
        }
      }
    }

    // Convert aggregated data to heat strip points
    const points: HeatStripDataPoint[] = [];
    const sortedTimestamps = Array.from(aggregatedByTime.keys()).sort((a, b) => a - b);

    for (const timestamp of sortedTimestamps) {
      const timestampData = aggregatedByTime.get(timestamp)!;
      const metricSnapshots = new Map<string, MetricSnapshot>();
      let maxPercent = 0;

      for (const [metricId, value] of timestampData.entries()) {
        if (value.limit > 0) {
          const percent = value.used / value.limit;
          metricSnapshots.set(metricId, { percent, used: value.used, limit: value.limit });
          maxPercent = Math.max(maxPercent, percent);
        }
      }

      points.push({
        timestamp,
        maxPercent,
        metricSnapshots,
      });
    }

    this.cachedData = {
      points,
      hasData: points.length > 0,
      metrics: timeSeries.metrics,
    };

    return this.cachedData;
  }

  /**
   * Get cached heat strip data.
   */
  public getData(): HeatStripData | null {
    return this.cachedData;
  }

  /**
   * Check if there's heat strip data to display.
   */
  public hasData(): boolean {
    return this.cachedData?.hasData ?? false;
  }

  /**
   * Get color for a given percentage value.
   *
   * @param percent - Usage percentage (0-1+)
   * @returns Hex color value, or null for transparent (safe zone)
   */
  private getColorForPercent(percent: number): number | null {
    if (percent < THRESHOLD_WARNING) {
      return null; // Safe zone - transparent
    } else if (percent < THRESHOLD_CRITICAL) {
      return COLOR_WARNING;
    } else if (percent < THRESHOLD_BREACH) {
      return COLOR_CRITICAL;
    } else {
      return COLOR_BREACH;
    }
  }

  /**
   * Render the heat strip.
   *
   * @param manager - MinimapManager for coordinate transforms
   * @param minimapHeight - Total minimap height
   * @param totalDuration - Total timeline duration in nanoseconds
   */
  public render(manager: MinimapManager, minimapHeight: number, totalDuration: number): void {
    this.graphics.clear();

    if (!this.cachedData?.hasData) {
      return;
    }

    const points = this.cachedData.points;
    const stripY = minimapHeight - HEAT_STRIP_HEIGHT;

    // Render each segment from one timestamp to the next
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const color = this.getColorForPercent(point.maxPercent);

      // Skip transparent segments
      if (color === null) {
        continue;
      }

      // Calculate X bounds for this segment
      const startX = manager.timeToMinimapX(point.timestamp);
      const endTime = points[i + 1]?.timestamp ?? totalDuration;
      const endX = manager.timeToMinimapX(endTime);
      const width = endX - startX;

      // Skip zero-width segments
      if (width <= 0) {
        continue;
      }

      // Draw the segment
      this.graphics.rect(startX, stripY, width, HEAT_STRIP_HEIGHT);
      this.graphics.fill({ color, alpha: HEAT_STRIP_OPACITY });
    }
  }

  /**
   * Find the data point closest to a given time.
   *
   * @param timeNs - Time in nanoseconds
   * @returns Data point and next timestamp, or null if no data
   */
  public getDataPointAtTime(timeNs: number): { point: HeatStripDataPoint; endTime: number } | null {
    if (!this.cachedData?.hasData) {
      return null;
    }

    const points = this.cachedData.points;

    // Find the last point at or before timeNs using binary search
    let left = 0;
    let right = points.length - 1;
    let result = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (points[mid]!.timestamp <= timeNs) {
        result = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    if (result === -1) {
      return null;
    }

    const point = points[result]!;
    const endTime = points[result + 1]?.timestamp ?? Infinity;

    // Check if timeNs is within this segment
    if (timeNs >= point.timestamp && timeNs < endTime) {
      return { point, endTime };
    }

    return null;
  }

  /**
   * Get metric definitions for tooltip formatting.
   */
  public getMetrics(): Map<string, HeatStripMetric> | null {
    return this.cachedData?.metrics ?? null;
  }

  /**
   * Destroy and clean up resources.
   */
  public destroy(): void {
    this.graphics.destroy();
    this.cachedData = null;
  }
}
