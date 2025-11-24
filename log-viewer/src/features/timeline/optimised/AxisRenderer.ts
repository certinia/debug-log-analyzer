/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * AxisRenderer
 *
 * Renders time scale axis with dynamic labels and tick marks.
 * Adapts tick density and label precision based on zoom level.
 *
 * Tick levels (zoom-dependent):
 * - Seconds: Major ticks at 1s, 2s, 5s, 10s intervals
 * - Milliseconds: Major ticks at 1ms, 2ms, 5ms, 10ms intervals
 * - Microseconds: Major ticks at 1μs, 2μs, 5μs, 10μs intervals
 * - Nanoseconds: Major ticks at 1ns, 2ns, 5ns, 10ns intervals
 */

import * as PIXI from 'pixi.js';
import type { ViewportState } from '../types/timeline.types.js';

/**
 * Nanoseconds per millisecond conversion constant.
 */
const NS_PER_MS = 1_000_000;

/**
 * Axis rendering configuration.
 */
interface AxisConfig {
  /** Height of axis area in pixels */
  height: number;
  /** Color of axis line and ticks */
  lineColor: number;
  /** Color of axis labels */
  textColor: string;
  /** Font size for labels */
  fontSize: number;
  /** Minimum spacing between labels in pixels */
  minLabelSpacing: number;
}

/**
 * Time interval for tick marks.
 */
interface TickInterval {
  /** Interval duration in nanoseconds */
  interval: number;
  /** Skip factor (1 = show all, 2 = show every 2nd, 5 = show every 5th) */
  skipFactor: number;
}

export class AxisRenderer {
  private container: PIXI.Container;
  private graphics: PIXI.Graphics;
  private labelsContainer: PIXI.Container;
  private screenSpaceContainer: PIXI.Container | null = null;
  private config: AxisConfig;
  private labelCache: Map<string, PIXI.Text> = new Map();

  constructor(container: PIXI.Container, config?: Partial<AxisConfig>) {
    this.container = container;

    // Default configuration
    this.config = {
      height: 30,
      lineColor: 0x808080, // Medium gray that works in light and dark themes
      textColor: '#808080', // Medium gray that works in light and dark themes
      fontSize: 11,
      minLabelSpacing: 80,
      ...config,
    };

    // Create graphics for axis line and ticks (in world space - will be transformed with stage)
    this.graphics = new PIXI.Graphics();
    this.container.addChild(this.graphics);

    // Labels container - will be added to screen space container when provided
    this.labelsContainer = new PIXI.Container();
  }

  /**
   * Set the screen-space container for labels (not affected by stage transforms).
   * This container should be added directly to app.stage at root level.
   */
  public setScreenSpaceContainer(container: PIXI.Container): void {
    this.screenSpaceContainer = container;

    // Move labels to screen space container
    if (this.labelsContainer.parent) {
      this.labelsContainer.parent.removeChild(this.labelsContainer);
    }
    this.screenSpaceContainer.addChild(this.labelsContainer);

    // Set up coordinate system for labels (top-left origin, Y pointing down for text)
    this.labelsContainer.position.set(0, 0);
    this.labelsContainer.scale.set(1, 1);
  }

  /**
   * Render axis based on current viewport state.
   *
   * Implements dynamic tick calculation and label density management.
   * @param viewport - Current viewport state
   */
  public render(viewport: ViewportState): void {
    // Clear previous rendering
    this.graphics.clear();
    this.clearLabels();

    // Calculate visible time range
    const timeStart = viewport.offsetX / viewport.zoom;
    const timeEnd = (viewport.offsetX + viewport.displayWidth) / viewport.zoom;

    // Calculate appropriate tick interval based on zoom
    const tickInterval = this.calculateTickInterval(viewport);

    // Render tick marks (vertical lines from top to bottom, behind rectangles)
    this.renderTicks(viewport, timeStart, timeEnd, tickInterval);
  }

  /**
   * Clean up resources.
   */
  public destroy(): void {
    this.graphics.destroy();
    this.labelsContainer.destroy();
    this.labelCache.clear();
  }

  // ============================================================================
  // PRIVATE: TICK CALCULATION
  // ============================================================================

  /**
   * Calculate appropriate tick interval based on zoom level.
   *
   * Uses 1-2-5 sequence for millisecond intervals.
   * Implements skip factor when labels would be too close.
   */
  private calculateTickInterval(viewport: ViewportState): TickInterval {
    // Calculate pixels per nanosecond
    const pixelsPerNs = viewport.zoom;

    // Target: one label every minLabelSpacing pixels
    const targetIntervalNs = this.config.minLabelSpacing / pixelsPerNs;

    // Convert to milliseconds
    const targetIntervalMs = targetIntervalNs / NS_PER_MS;

    // Find appropriate interval using 1-2-5 sequence
    const { interval, skipFactor } = this.selectInterval(targetIntervalMs);

    return {
      interval: interval * NS_PER_MS, // Convert back to nanoseconds
      skipFactor,
    };
  }

  /**
   * Select appropriate interval using 1-2-5 sequence.
   * Returns interval in milliseconds and skip factor for label density.
   */
  private selectInterval(targetMs: number): { interval: number; skipFactor: number } {
    // Base intervals using 1-2-5 sequence
    // Extended to support 0.001ms (1 microsecond) precision when zoomed way in
    const baseIntervals = [
      // Sub-millisecond (microseconds in ms)
      0.001, // 1 microsecond
      0.002, // 2 microseconds
      0.005, // 5 microseconds
      // Tens of microseconds
      0.01, // 10 microseconds
      0.02, // 20 microseconds
      0.05, // 50 microseconds
      // Hundreds of microseconds
      0.1, // 100 microseconds
      0.2, // 200 microseconds
      0.5, // 500 microseconds
      // Milliseconds
      1,
      2,
      5,
      10,
      20,
      50,
      100,
      200,
      500,
      // Seconds
      1000,
      2000,
      5000,
      10000,
    ];

    // Find smallest interval >= targetMs
    let interval = baseIntervals[baseIntervals.length - 1] ?? 1000;
    for (const candidate of baseIntervals) {
      if (candidate >= targetMs) {
        interval = candidate;
        break;
      }
    }

    // Default skip factor of 1 (show all labels)
    let skipFactor = 1;

    // If labels are still too close, increase skip factor
    // This happens when zoomed way out
    if (interval >= 1000) {
      // For large intervals (1s+), potentially skip every 2nd or 5th
      if (targetMs > interval * 1.5) {
        skipFactor = 2;
      }
      if (targetMs > interval * 3) {
        skipFactor = 5;
      }
    }

    return { interval, skipFactor };
  }

  // ============================================================================
  // PRIVATE: RENDERING
  // ============================================================================

  /**
   * Render vertical tick lines with labels at the top.
   */
  private renderTicks(
    viewport: ViewportState,
    timeStart: number,
    timeEnd: number,
    tickInterval: TickInterval,
  ): void {
    // Calculate first tick position (snap to interval boundary)
    // Go back one extra tick to ensure we cover the left edge
    const firstTickIndex = Math.floor(timeStart / tickInterval.interval) - 1;

    // Calculate last tick position
    // Go forward one extra tick to ensure we cover the right edge
    const lastTickIndex = Math.ceil(timeEnd / tickInterval.interval) + 1;

    // Track rendered pixel positions to prevent duplicates
    const renderedPixels = new Set<number>();

    // Render all ticks in range
    for (let i = firstTickIndex; i <= lastTickIndex; i++) {
      const time = i * tickInterval.interval;

      // Calculate screen position and round to pixel
      const screenX = time * viewport.zoom;
      const pixelX = Math.round(screenX);

      // Skip if we already rendered a line at this pixel position
      if (renderedPixels.has(pixelX)) {
        continue;
      }
      renderedPixels.add(pixelX);

      // Calculate if this tick should show a label based on global position
      // This ensures labels stay consistent when panning
      const shouldShowLabel = i % tickInterval.skipFactor === 0;

      this.renderVerticalLine(screenX, viewport.displayHeight, time, shouldShowLabel, viewport);
    }
  }

  /**
   * Render a vertical line from top to bottom with optional label at top.
   */
  private renderVerticalLine(
    screenX: number,
    viewportHeight: number,
    timeNs: number,
    showLabel: boolean,
    viewport: ViewportState,
  ): void {
    // Round screen position to prevent sub-pixel rendering issues
    const roundedX = Math.round(screenX);

    // Draw vertical line from top (viewportHeight in inverted coords) to bottom (0)
    // Use rect instead of line for more consistent rendering
    this.graphics.setFillStyle({
      color: this.config.lineColor,
      alpha: 0.3, // Semi-transparent so it doesn't overpower the rectangles
    });
    this.graphics.rect(roundedX, 0, 1, viewportHeight);
    this.graphics.fill();

    // Add label at top if requested
    if (showLabel && this.screenSpaceContainer) {
      const timeMs = timeNs / NS_PER_MS;
      const labelText = this.formatMilliseconds(timeMs);

      // Only show label if not empty (skip zero)
      if (labelText) {
        const label = this.getOrCreateLabel(labelText);

        // Calculate screen-space X position (accounting for stage pan)
        // screenX is in world space, need to convert to screen space
        const screenSpaceX = screenX - viewport.offsetX;

        // Position label in screen space (top-left origin, Y pointing down)
        label.x = screenSpaceX - 3; // 3px to the left of line
        label.y = 5; // 5px from top
        label.anchor.set(1, 0); // Right-align to line, align top
      }
    }
  }

  // ============================================================================
  // PRIVATE: LABEL MANAGEMENT
  // ============================================================================

  /**
   * Get or create a PIXI.Text label from cache.
   * Reuses labels to avoid constant object creation.
   */
  private getOrCreateLabel(text: string): PIXI.Text {
    let label = this.labelCache.get(text);

    if (!label) {
      label = new PIXI.Text({
        text,
        style: {
          fontFamily: 'monospace',
          fontSize: this.config.fontSize,
          fill: this.config.textColor,
        },
      });
      this.labelCache.set(text, label);
      this.labelsContainer.addChild(label);
    }

    // Make label visible
    label.visible = true;

    return label;
  }

  /**
   * Hide all labels (for next render pass).
   */
  private clearLabels(): void {
    for (const label of this.labelCache.values()) {
      label.visible = false;
    }
  }

  // ============================================================================
  // PRIVATE: FORMATTING
  // ============================================================================

  /**
   * Format time with appropriate units and precision.
   * - Whole seconds: "1 s", "2 s" (not "1000 ms")
   * - Milliseconds: up to 3 decimal places: "18800.345 ms"
   * - Omit zero: don't show "0 s" or "0 ms", just start from first non-zero
   */
  private formatMilliseconds(timeMs: number): string {
    // Omit zero
    if (timeMs === 0) {
      return '';
    }

    // Convert to seconds if >= 1000ms and whole seconds
    if (timeMs >= 1000 && timeMs % 1000 === 0) {
      const seconds = timeMs / 1000;
      return `${seconds} s`;
    }

    // Format as milliseconds with up to 3 decimal places
    // Remove trailing zeros after decimal point
    const formatted = timeMs.toFixed(3);
    const trimmed = formatted.replace(/\.?0+$/, '');
    return `${trimmed} ms`;
  }
}
