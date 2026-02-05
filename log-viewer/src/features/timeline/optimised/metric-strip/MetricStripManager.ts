/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MetricStripManager
 *
 * State management and tier classification for the governor limit metric strip.
 * Transforms generic time series data into classified, renderable format.
 *
 * Tier Classification Algorithm:
 * 1. Calculate global max percentage for each metric across all timestamps
 * 2. Tier 1: Top 3 metrics by global max (always shown, solid 2px lines)
 * 3. Tier 2: Any metric exceeding 80% at any point (auto-promoted, solid 2px)
 * 4. Tier 3: Remaining metrics (aggregated as max, grey dashed 1.5px)
 *
 * Responsibilities:
 * - Process HeatStripTimeSeries into MetricStripProcessedData
 * - Classify metrics into tiers
 * - Aggregate Tier 3 metrics
 * - Provide data for rendering
 */

import type {
  HeatStripTimeSeries,
  MetricStripClassifiedMetric,
  MetricStripDataPoint,
  MetricStripProcessedData,
} from '../../types/flamechart.types.js';
import {
  getRankBasedColor,
  METRIC_STRIP_THRESHOLDS,
  METRIC_STRIP_Y_MAX_PERCENT,
} from './metric-strip-colors.js';

/**
 * Number of top metrics to always show as Tier 1.
 */
const TIER_1_COUNT = 3;

/**
 * Threshold for auto-promotion to Tier 2 (80%).
 */
const TIER_2_THRESHOLD = METRIC_STRIP_THRESHOLDS.dangerStart;

/** Cached lookup result for getDataPointAtTime optimization. */
interface CachedLookup {
  /** Start time of the cached segment (inclusive). */
  startTime: number;
  /** End time of the cached segment (exclusive). */
  endTime: number;
  /** The cached result. */
  result: { point: MetricStripDataPoint; endTime: number };
}

export class MetricStripManager {
  /** Processed metric strip data ready for rendering. */
  private processedData: MetricStripProcessedData | null = null;

  /** Single-entry cache for getDataPointAtTime to avoid repeated binary searches. */
  private lookupCache: CachedLookup | null = null;

  /**
   * Process time series data into metric strip format.
   *
   * @param timeSeries - Input time series data
   * @returns Processed metric strip data
   */
  public processData(timeSeries: HeatStripTimeSeries): MetricStripProcessedData {
    // Clear lookup cache when data changes
    this.lookupCache = null;

    if (timeSeries.events.length === 0) {
      this.processedData = {
        points: [],
        classifiedMetrics: [],
        globalMaxPercent: 0,
        hasData: false,
      };
      return this.processedData;
    }

    // Step 1: Aggregate events by timestamp (sum used values across namespaces)
    const aggregatedByTime = this.aggregateByTimestamp(timeSeries);

    // Step 2: Calculate global max percentage for each metric
    const metricMaxPercents = this.calculateMetricMaxPercents(aggregatedByTime, timeSeries);

    // Step 3: Classify metrics into tiers
    const classifiedMetrics = this.classifyMetrics(metricMaxPercents, timeSeries);

    // Step 4: Build data points with tier classification
    const { points, globalMaxPercent } = this.buildDataPoints(
      aggregatedByTime,
      classifiedMetrics,
      timeSeries,
    );

    this.processedData = {
      points,
      classifiedMetrics,
      globalMaxPercent,
      hasData: points.length > 0,
    };

    return this.processedData;
  }

  /**
   * Get the processed metric strip data.
   */
  public getData(): MetricStripProcessedData | null {
    return this.processedData;
  }

  /**
   * Check if there's data to render.
   */
  public hasData(): boolean {
    return this.processedData?.hasData ?? false;
  }

  /**
   * Get classified metrics (for legend/tooltip display).
   */
  public getClassifiedMetrics(): MetricStripClassifiedMetric[] {
    return this.processedData?.classifiedMetrics ?? [];
  }

  /**
   * Get metrics visible in the chart (Tier 1 and Tier 2 only).
   */
  public getVisibleMetrics(): MetricStripClassifiedMetric[] {
    return this.getClassifiedMetrics().filter((m) => m.tier === 1 || m.tier === 2);
  }

  /**
   * Get the effective Y-axis maximum for dynamic scaling.
   * Default is METRIC_STRIP_Y_MAX_PERCENT (1.1 = 110%).
   * Always adds +10% headroom above the max data value.
   *
   * @returns Effective Y-max percentage (e.g., 1.1 for 110%)
   */
  public getEffectiveYMax(): number {
    if (!this.processedData) {
      return METRIC_STRIP_Y_MAX_PERCENT;
    }

    const dataMax = this.processedData.globalMaxPercent;
    // Always +10% above max, with minimum of 110%
    const calculatedMax = Math.ceil(dataMax * 10) / 10 + 0.1;
    return Math.max(METRIC_STRIP_Y_MAX_PERCENT, calculatedMax);
  }

  /**
   * Get data point at a specific time using binary search.
   * Uses single-entry cache to optimize repeated lookups within the same segment
   * (common during mouse movement within a time bucket).
   *
   * @param timeNs - Time in nanoseconds
   * @returns Data point and next timestamp, or null if not found
   */
  public getDataPointAtTime(
    timeNs: number,
  ): { point: MetricStripDataPoint; endTime: number } | null {
    if (!this.processedData?.hasData) {
      return null;
    }

    // Check cache first - if timeNs falls within the cached segment, return cached result
    if (
      this.lookupCache &&
      timeNs >= this.lookupCache.startTime &&
      timeNs < this.lookupCache.endTime
    ) {
      return this.lookupCache.result;
    }

    const points = this.processedData.points;

    // Binary search for the last point at or before timeNs
    let left = 0;
    let right = points.length - 1;
    let resultIdx = -1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (points[mid]!.timestamp <= timeNs) {
        resultIdx = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    if (resultIdx === -1) {
      return null;
    }

    const point = points[resultIdx]!;
    const endTime = points[resultIdx + 1]?.timestamp ?? Infinity;

    // Check if timeNs is within this segment
    if (timeNs >= point.timestamp && timeNs < endTime) {
      const result = { point, endTime };

      // Cache this lookup for subsequent queries in the same segment
      this.lookupCache = {
        startTime: point.timestamp,
        endTime,
        result,
      };

      return result;
    }

    return null;
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Aggregate events by timestamp, summing used values across namespaces.
   */
  private aggregateByTimestamp(
    timeSeries: HeatStripTimeSeries,
  ): Map<number, Map<string, { used: number; limit: number }>> {
    const aggregated = new Map<number, Map<string, { used: number; limit: number }>>();

    for (const event of timeSeries.events) {
      let timestampData = aggregated.get(event.timestamp);
      if (!timestampData) {
        timestampData = new Map();
        aggregated.set(event.timestamp, timestampData);
      }

      // Sum used values across namespaces for each metric
      for (const [metricId, value] of event.values) {
        const existing = timestampData.get(metricId);
        if (existing) {
          existing.used += value.used;
        } else {
          timestampData.set(metricId, { used: value.used, limit: value.limit });
        }
      }
    }

    return aggregated;
  }

  /**
   * Calculate the global maximum percentage for each metric.
   */
  private calculateMetricMaxPercents(
    aggregatedByTime: Map<number, Map<string, { used: number; limit: number }>>,
    timeSeries: HeatStripTimeSeries,
  ): Map<string, number> {
    const maxPercents = new Map<string, number>();

    // Initialize all metrics with 0
    for (const metricId of timeSeries.metrics.keys()) {
      maxPercents.set(metricId, 0);
    }

    // Find max percentage for each metric
    for (const timestampData of aggregatedByTime.values()) {
      for (const [metricId, value] of timestampData) {
        if (value.limit > 0) {
          const percent = value.used / value.limit;
          const currentMax = maxPercents.get(metricId) ?? 0;
          if (percent > currentMax) {
            maxPercents.set(metricId, percent);
          }
        }
      }
    }

    return maxPercents;
  }

  /**
   * Classify metrics into tiers based on their global max percentages.
   * Colors are assigned by rank within each tier, not by metric type.
   */
  private classifyMetrics(
    metricMaxPercents: Map<string, number>,
    timeSeries: HeatStripTimeSeries,
  ): MetricStripClassifiedMetric[] {
    // Create array of metrics with their max percents for sorting
    const metricsWithMax: Array<{
      metricId: string;
      displayName: string;
      priority: number;
      maxPercent: number;
      unit: string;
    }> = [];

    for (const [metricId, maxPercent] of metricMaxPercents) {
      const metricDef = timeSeries.metrics.get(metricId);
      metricsWithMax.push({
        metricId,
        displayName: metricDef?.displayName ?? metricId,
        priority: metricDef?.priority ?? 999,
        maxPercent,
        unit: metricDef?.unit ?? '',
      });
    }

    // Sort by max percent descending
    metricsWithMax.sort((a, b) => b.maxPercent - a.maxPercent);

    // Classify into tiers and track rank within each tier
    const classified: MetricStripClassifiedMetric[] = [];
    let tier1Rank = 0;
    let tier2Rank = 0;
    let tier3Rank = 0;

    for (let i = 0; i < metricsWithMax.length; i++) {
      const metric = metricsWithMax[i]!;

      let tier: 1 | 2 | 3;
      let rankInTier: number;

      if (i < TIER_1_COUNT) {
        // Top 3 metrics are always Tier 1
        tier = 1;
        rankInTier = tier1Rank++;
      } else if (metric.maxPercent >= TIER_2_THRESHOLD) {
        // Metrics that exceed 80% are Tier 2
        tier = 2;
        rankInTier = tier2Rank++;
      } else {
        // Everything else is Tier 3
        tier = 3;
        rankInTier = tier3Rank++;
      }

      classified.push({
        metricId: metric.metricId,
        displayName: metric.displayName,
        tier,
        globalMaxPercent: metric.maxPercent,
        color: getRankBasedColor(tier, rankInTier),
        priority: metric.priority,
        unit: metric.unit,
      });
    }

    return classified;
  }

  /**
   * Build data points with tier-based aggregation.
   */
  private buildDataPoints(
    aggregatedByTime: Map<number, Map<string, { used: number; limit: number }>>,
    classifiedMetrics: MetricStripClassifiedMetric[],
    _timeSeries: HeatStripTimeSeries,
  ): { points: MetricStripDataPoint[]; globalMaxPercent: number } {
    // Create lookup for tier by metric ID
    const metricTiers = new Map<string, 1 | 2 | 3>();
    for (const metric of classifiedMetrics) {
      metricTiers.set(metric.metricId, metric.tier);
    }

    const points: MetricStripDataPoint[] = [];
    let globalMaxPercent = 0;

    // Sort timestamps
    const timestamps = Array.from(aggregatedByTime.keys()).sort((a, b) => a - b);

    for (const timestamp of timestamps) {
      const timestampData = aggregatedByTime.get(timestamp)!;
      const values = new Map<string, number>();
      const rawValues = new Map<string, { used: number; limit: number }>();
      let tier3Max = 0;

      for (const [metricId, value] of timestampData) {
        if (value.limit > 0) {
          const percent = value.used / value.limit;
          values.set(metricId, percent);
          rawValues.set(metricId, { used: value.used, limit: value.limit });

          // Track global max
          if (percent > globalMaxPercent) {
            globalMaxPercent = percent;
          }

          // Track Tier 3 max for aggregation
          const tier = metricTiers.get(metricId);
          if (tier === 3 && percent > tier3Max) {
            tier3Max = percent;
          }
        }
      }

      points.push({
        timestamp,
        values,
        rawValues,
        tier3Max,
      });
    }

    return { points, globalMaxPercent };
  }
}
