/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapAxisRenderer
 *
 * Renders a static time axis at the TOP of the minimap area.
 * Unlike the main timeline axis which follows zoom/pan, this axis always
 * shows the full transaction duration (0ms to End).
 *
 * Visual design:
 * - Tick marks extend downward from the top edge of minimap
 * - Labels positioned below tick marks
 * - Uses same 1-2-5 tick interval sequence as main axis
 * - Adapts tick density based on minimap width
 *
 * Performance:
 * - Part of minimap's static content (only redrawn on resize/data change)
 * - Uses PIXI.Graphics for tick lines
 * - Uses PIXI.BitmapText for labels (pre-rendered font atlas)
 */

import { BitmapText, Container, Graphics } from 'pixi.js';
import { TEXT_LABEL_CONSTANTS } from '../../types/flamechart.types.js';
import type { MinimapManager } from './MinimapManager.js';

/**
 * Nanoseconds per millisecond conversion constant.
 */
const NS_PER_MS = 1_000_000;

/**
 * Axis configuration.
 */
interface MinimapAxisConfig {
  /** Height of the axis area at bottom of minimap */
  axisHeight: number;
  /** Tick line color */
  tickColor: number;
  /** Label text tint color (numeric for BitmapText) */
  labelTint: number;
  /** Font size for labels (should match TEXT_LABEL_CONSTANTS.FONT.SIZE for consistency) */
  fontSize: number;
  /** Minimum spacing between labels in pixels */
  minLabelSpacing: number;
}

const DEFAULT_CONFIG: MinimapAxisConfig = {
  axisHeight: 16,
  tickColor: 0x808080,
  labelTint: 0xc0c0c0, // Brighter color, not dimmed
  fontSize: 10, // Match main axis font size for consistency
  minLabelSpacing: 80,
};

export class MinimapAxisRenderer {
  private config: MinimapAxisConfig;

  /** Graphics object for tick lines */
  private tickGraphics: Graphics;

  /** Container for text labels */
  private labelsContainer: Container;

  /** Pool of BitmapText labels for reuse (crisp pre-rendered glyphs) */
  private labelPool: BitmapText[] = [];
  private activeLabelCount = 0;

  /**
   * Creates the axis renderer without adding to any parent container.
   * Caller is responsible for adding getTickGraphics() and getLabelsContainer()
   * to their container in the desired layer order.
   *
   * @param config - Optional configuration overrides
   */
  constructor(config?: Partial<MinimapAxisConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create graphics for tick lines
    this.tickGraphics = new Graphics();

    // Create container for labels
    this.labelsContainer = new Container();
  }

  /**
   * Get the tick graphics object for adding to a parent container.
   * This should be added BELOW the skyline in the layer order.
   */
  public getTickGraphics(): Graphics {
    return this.tickGraphics;
  }

  /**
   * Get the labels container for adding to a parent container.
   * This should be added ABOVE the skyline in the layer order.
   */
  public getLabelsContainer(): Container {
    return this.labelsContainer;
  }

  /**
   * Get the height of the axis area.
   */
  public getHeight(): number {
    return this.config.axisHeight;
  }

  /**
   * Render the time axis based on minimap state.
   * Shows full timeline duration (0 to totalDuration) regardless of main viewport zoom.
   *
   * @param manager - MinimapManager with state and coordinate transforms
   */
  public render(manager: MinimapManager): void {
    this.tickGraphics.clear();
    this.hideAllLabels();
    this.activeLabelCount = 0;

    const state = manager.getState();
    const { totalDuration, displayWidth, height: minimapHeight } = state;

    if (totalDuration <= 0 || displayWidth <= 0) {
      return;
    }

    // Position axis at TOP of minimap
    // axisY is the TOP of the axis area (Y=0)
    const axisY = 0;

    // Calculate tick interval based on minimap scale (not main viewport zoom)
    const tickInterval = this.calculateTickInterval(displayWidth, totalDuration);

    // Calculate first and last tick indices
    const firstTickIndex = 0;
    const lastTickIndex = Math.ceil(totalDuration / tickInterval.interval);

    // Render ticks and labels
    for (let i = firstTickIndex; i <= lastTickIndex; i++) {
      const timeNs = i * tickInterval.interval;

      // Skip if beyond timeline
      if (timeNs > totalDuration) {
        break;
      }

      const x = manager.timeToMinimapX(timeNs);

      // Skip if outside visible area (with small margin)
      if (x < -5 || x > displayWidth + 5) {
        continue;
      }

      // Determine if this tick should show a label
      const shouldShowLabel = i % tickInterval.skipFactor === 0;

      // Draw tick line full height of minimap
      this.tickGraphics.moveTo(x, axisY);
      this.tickGraphics.lineTo(x, minimapHeight);
      this.tickGraphics.stroke({ color: this.config.tickColor, width: 1 });

      // Add label if needed (positioned to the left of the line)
      if (shouldShowLabel && timeNs > 0) {
        const label = this.getOrCreateLabel();
        label.text = this.formatTime(timeNs);
        label.x = x - 3; // 3px to the left of line
        label.y = axisY + 2; // Near top
        label.anchor.set(1, 0); // Right-align to line
        label.visible = true;
        this.activeLabelCount++;
      }
    }
  }

  /**
   * Clear all graphics.
   */
  public clear(): void {
    this.tickGraphics.clear();
    this.hideAllLabels();
    this.activeLabelCount = 0;
  }

  /**
   * Refresh colors from CSS variables (e.g., after VS Code theme change).
   * Updates tick and label colors.
   */
  public refreshColors(): void {
    // Re-extract colors from CSS variables
    const computedStyle = getComputedStyle(document.documentElement);

    // Update tick color
    const tickColorStr =
      computedStyle.getPropertyValue('--vscode-editorLineNumber-foreground').trim() || '#808080';
    this.config.tickColor = this.parseColorToHex(tickColorStr);

    // Update label tint color
    this.config.labelTint = this.parseColorToHex(tickColorStr);

    // Update existing labels with new tint (BitmapText uses tint for color)
    for (const label of this.labelPool) {
      label.tint = this.config.labelTint;
    }
  }

  /**
   * Parse CSS color string to numeric hex.
   */
  private parseColorToHex(cssColor: string): number {
    if (!cssColor) {
      return 0x808080;
    }

    if (cssColor.startsWith('#')) {
      const hex = cssColor.slice(1);
      if (hex.length === 6) {
        return parseInt(hex, 16);
      }
      if (hex.length === 3) {
        const r = hex[0]!;
        const g = hex[1]!;
        const b = hex[2]!;
        return parseInt(r + r + g + g + b + b, 16);
      }
    }

    // rgba() fallback
    const rgba = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgba) {
      const r = parseInt(rgba[1]!, 10);
      const g = parseInt(rgba[2]!, 10);
      const b = parseInt(rgba[3]!, 10);
      return (r << 16) | (g << 8) | b;
    }

    return 0x808080;
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    this.tickGraphics.destroy();
    for (const label of this.labelPool) {
      label.destroy();
    }
    this.labelPool = [];
    this.labelsContainer.destroy();
  }

  // ============================================================================
  // PRIVATE: TICK CALCULATION
  // ============================================================================

  /**
   * Calculate appropriate tick interval based on available width and duration.
   */
  private calculateTickInterval(
    displayWidth: number,
    totalDuration: number,
  ): { interval: number; skipFactor: number } {
    // Calculate pixels per nanosecond for minimap (full duration fits in width)
    const pixelsPerNs = displayWidth / totalDuration;

    // Target: one label every minLabelSpacing pixels
    const targetIntervalNs = this.config.minLabelSpacing / pixelsPerNs;

    // Convert to milliseconds
    const targetIntervalMs = targetIntervalNs / NS_PER_MS;

    // Find appropriate interval using 1-2-5 sequence
    return this.selectInterval(targetIntervalMs);
  }

  /**
   * Select appropriate interval using 1-2-5 sequence.
   */
  private selectInterval(targetMs: number): { interval: number; skipFactor: number } {
    // Base intervals using 1-2-5 sequence (in milliseconds)
    const baseIntervals = [
      0.001,
      0.002,
      0.005, // Microseconds
      0.01,
      0.02,
      0.05, // Tens of microseconds
      0.1,
      0.2,
      0.5, // Hundreds of microseconds
      1,
      2,
      5, // Milliseconds
      10,
      20,
      50, // Tens of milliseconds
      100,
      200,
      500, // Hundreds of milliseconds
      1000,
      2000,
      5000, // Seconds
      10000,
      20000,
      50000, // Tens of seconds
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
    if (targetMs > interval * 1.5) {
      skipFactor = 2;
    }
    if (targetMs > interval * 3) {
      skipFactor = 5;
    }

    // Return interval in nanoseconds
    return {
      interval: interval * NS_PER_MS,
      skipFactor,
    };
  }

  // ============================================================================
  // PRIVATE: LABEL MANAGEMENT
  // ============================================================================

  /**
   * Get or create a BitmapText label from pool.
   * Uses the 'timeline-mono' BitmapFont for crisp pre-rendered glyphs.
   */
  private getOrCreateLabel(): BitmapText {
    if (this.activeLabelCount < this.labelPool.length) {
      return this.labelPool[this.activeLabelCount]!;
    }

    // Create new BitmapText label using the shared 'timeline-mono' font
    // This font is installed at 2x resolution by TextLabelRenderer.loadFont()
    const label = new BitmapText({
      text: '',
      style: {
        fontFamily: TEXT_LABEL_CONSTANTS.FONT.FAMILY,
        fontSize: this.config.fontSize,
      },
    });
    label.tint = this.config.labelTint;
    label.visible = false;
    this.labelPool.push(label);
    this.labelsContainer.addChild(label);

    return label;
  }

  /**
   * Hide all labels in pool.
   */
  private hideAllLabels(): void {
    for (const label of this.labelPool) {
      label.visible = false;
    }
  }

  // ============================================================================
  // PRIVATE: FORMATTING
  // ============================================================================

  /**
   * Format time with appropriate units.
   * Similar to main axis but more compact for minimap.
   */
  private formatTime(timeNs: number): string {
    const timeMs = timeNs / NS_PER_MS;

    // Convert to seconds if >= 1000ms and whole seconds
    if (timeMs >= 1000 && timeMs % 1000 === 0) {
      const seconds = timeMs / 1000;
      return `${seconds}s`;
    }

    // Format as milliseconds
    if (timeMs >= 1) {
      // Whole milliseconds: no decimals
      if (timeMs === Math.floor(timeMs)) {
        return `${Math.floor(timeMs)}ms`;
      }
      // Fractional: up to 2 decimal places
      return `${timeMs.toFixed(2).replace(/\.?0+$/, '')}ms`;
    }

    // Sub-millisecond: show as microseconds
    const timeUs = timeMs * 1000;
    return `${Math.round(timeUs)}µs`;
  }
}
