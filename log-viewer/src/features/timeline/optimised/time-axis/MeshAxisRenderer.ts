/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MeshAxisRenderer
 *
 * Renders time scale axis with dynamic labels and tick marks using PixiJS Mesh.
 * Adapts tick density and label precision based on zoom level.
 * Delegates label formatting to strategy renderers (elapsed vs wall-clock).
 *
 * Performance optimizations:
 * - Single Mesh draw call for all grid lines
 * - Direct buffer updates (no scene graph overhead)
 * - Clip-space coordinates (no uniform binding overhead)
 * - Labels use PIXI.Text (optimal for dynamic text with caching)
 *
 * Tick levels (zoom-dependent):
 * - Seconds: Major ticks at 1s, 2s, 5s, 10s intervals
 * - Milliseconds: Major ticks at 1ms, 2ms, 5ms, 10ms intervals
 * - Microseconds: Major ticks at 1us, 2us, 5us, 10us intervals
 * - Nanoseconds: Major ticks at 1ns, 2ns, 5ns, 10ns intervals
 */

import { Container, Geometry, Mesh, Shader, Text } from 'pixi.js';

import type { ViewportState } from '../../types/flamechart.types.js';
import { RectangleGeometry, type ViewportTransform } from '../RectangleGeometry.js';
import { createRectangleShader } from '../RectangleShader.js';
import { ClockTimeAxisRenderer } from './ClockTimeAxisRenderer.js';
import { ElapsedTimeAxisRenderer } from './ElapsedTimeAxisRenderer.js';

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
  /** Whether to show labels (default: true) */
  showLabels?: boolean;
  /** Grid line alpha/opacity (default: 1.0) */
  gridAlpha?: number;
}

/**
 * Time interval for tick marks.
 */
export interface TickInterval {
  /** Interval duration in nanoseconds */
  interval: number;
  /** Skip factor (1 = show all, 2 = show every 2nd, 5 = show every 5th) */
  skipFactor: number;
}

/**
 * Result from rendering a single tick label.
 */
export interface TickLabelResult {
  label: Text;
  isAnchor: boolean;
}

/**
 * Strategy interface for time axis label rendering.
 */
export interface TimeAxisLabelStrategy {
  /** Adjust tick interval (e.g., wall-clock sets skipFactor to 1) */
  adjustTickInterval(interval: TickInterval): TickInterval;
  /** Called before the tick loop to set up per-frame state */
  beginFrame(tickInterval: TickInterval, firstTickIndex: number, firstTimestampNs: number): void;
  /** Format and position a label for a single tick. Returns the created label or null. */
  renderTickLabel(
    time: number,
    screenSpaceX: number,
    getOrCreateLabel: (text: string) => Text,
    tickIndex?: number,
  ): TickLabelResult | null;
  /** Called after the tick loop (e.g., wall-clock updates sticky label) */
  endFrame(screenSpaceContainer: Container | null, hasSubMsTicks: boolean): void;
  /** Refresh colors after theme change */
  refreshColors(textColor: string): void;
  /** Clean up resources */
  destroy(): void;
}

export class MeshAxisRenderer {
  private geometry: RectangleGeometry;
  private shader: Shader;
  private mesh: Mesh<Geometry, Shader>;
  private labelsContainer: Container;
  private screenSpaceContainer: Container | null = null;
  private config: AxisConfig;
  /** Pool of reusable Text labels (index-based to support duplicate text) */
  private labelPool: Text[] = [];
  /** Number of active labels in current frame */
  private activeLabelCount = 0;
  /** Grid line color */
  private gridLineColor: number;

  /** Active label strategy */
  private strategy: TimeAxisLabelStrategy;

  constructor(container: Container, config?: Partial<AxisConfig>) {
    // Default configuration
    this.config = {
      height: 30,
      lineColor: 0x808080,
      textColor: '#808080',
      fontSize: 11,
      minLabelSpacing: 80,
      ...config,
    };

    this.gridLineColor = this.config.lineColor;

    // Create geometry and shader for grid lines
    this.geometry = new RectangleGeometry();
    this.shader = createRectangleShader();

    // Create mesh
    this.mesh = new Mesh<Geometry, Shader>({
      geometry: this.geometry.getGeometry(),
      shader: this.shader,
    });
    this.mesh.label = 'MeshAxisRenderer';
    container.addChild(this.mesh);

    // Labels container - will be added to screen space container when provided
    this.labelsContainer = new Container();

    // Default to elapsed time strategy
    this.strategy = new ElapsedTimeAxisRenderer();
  }

  /**
   * Set the stage container for clip-space rendering.
   * NOTE: With clip-space coordinates, we don't need to move to stage root.
   * The mesh outputs directly to gl_Position, bypassing all container transforms.
   */
  public setStageContainer(_stage: Container): void {
    // No-op: Keep mesh in axisContainer. Clip-space shader bypasses transforms anyway.
  }

  /**
   * Set the screen-space container for labels (not affected by stage transforms).
   * This container should be added directly to app.stage at root level.
   */
  public setScreenSpaceContainer(container: Container): void {
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
   * @param gridHeight - Optional height override for grid lines (defaults to viewport.displayHeight)
   */
  public render(viewport: ViewportState, gridHeight?: number): void {
    // Clear previous frame
    this.clearLabels();

    // Calculate visible time range
    const timeStart = viewport.offsetX / viewport.zoom;
    const timeEnd = (viewport.offsetX + viewport.displayWidth) / viewport.zoom;

    // Calculate appropriate tick interval based on zoom
    const tickInterval = this.calculateTickInterval(viewport);

    // Let strategy adjust the tick interval (e.g., wall-clock sets skipFactor to 1)
    const adjustedInterval = this.strategy.adjustTickInterval(tickInterval);

    // Render tick marks (vertical lines from top to bottom, behind rectangles)
    this.renderTicks(viewport, timeStart, timeEnd, adjustedInterval, gridHeight);
  }

  /**
   * Refresh colors from CSS variables (e.g., after VS Code theme change).
   * Updates grid line and label colors.
   */
  public refreshColors(): void {
    // Re-extract colors from CSS variables
    const computedStyle = getComputedStyle(document.documentElement);

    // Update grid line color
    const lineColorStr =
      computedStyle.getPropertyValue('--vscode-editorLineNumber-foreground').trim() || '#808080';
    this.gridLineColor = this.parseColorToHex(lineColorStr);
    this.config.lineColor = this.gridLineColor;

    // Update text color
    this.config.textColor =
      computedStyle.getPropertyValue('--vscode-editorLineNumber-foreground').trim() || '#808080';

    // Update existing labels with new color
    for (const label of this.labelPool) {
      label.style.fill = this.config.textColor;
    }

    // Update strategy colors
    this.strategy.refreshColors(this.config.textColor);
  }

  /**
   * Set the time display mode for axis labels.
   * In 'wallClock' mode, labels show wall-clock time (HH:MM:SS.mmm) instead of elapsed time.
   */
  public setTimeDisplayMode(
    mode: 'elapsed' | 'wallClock',
    startTimeMs: number,
    firstTimestampNs: number,
  ): void {
    // Destroy the old strategy to clean up resources
    this.strategy.destroy();

    if (mode === 'wallClock') {
      this.strategy = new ClockTimeAxisRenderer(
        startTimeMs,
        firstTimestampNs,
        this.config.fontSize,
        this.config.textColor,
      );
    } else {
      this.strategy = new ElapsedTimeAxisRenderer();
    }
  }

  /**
   * Clean up resources.
   */
  public destroy(): void {
    this.geometry.destroy();
    this.mesh.destroy();
    this.labelsContainer.destroy();
    this.labelPool.length = 0;
    this.activeLabelCount = 0;
    this.strategy.destroy();
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
    const { interval, skipFactor } = selectInterval(targetIntervalMs);

    return {
      interval: interval * NS_PER_MS, // Convert back to nanoseconds
      skipFactor,
    };
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
    gridHeight?: number,
  ): void {
    const effectiveHeight = gridHeight ?? viewport.displayHeight;
    const showLabels = this.config.showLabels !== false;
    const gridAlpha = this.config.gridAlpha ?? 1.0;

    // Calculate first tick position (snap to interval boundary)
    // Go back one extra tick to ensure we cover the left edge
    const firstTickIndex = Math.floor(timeStart / tickInterval.interval) - 1;

    // Calculate last tick position
    // Go forward one extra tick to ensure we cover the right edge
    const lastTickIndex = Math.ceil(timeEnd / tickInterval.interval) + 1;

    // Track rendered pixel positions to prevent duplicates
    const renderedPixels = new Set<number>();

    // Count ticks for buffer allocation
    const maxTicks = lastTickIndex - firstTickIndex + 1;
    this.geometry.ensureCapacity(maxTicks);

    // Create viewport transform for coordinate conversion
    // Note: offsetY is 0 because axis grid lines should span full screen height
    // regardless of vertical panning
    // No canvasYOffset needed - main timeline has its own canvas
    const viewportTransform: ViewportTransform = {
      offsetX: viewport.offsetX,
      offsetY: 0, // Full-height elements ignore Y pan
      displayWidth: viewport.displayWidth,
      displayHeight: effectiveHeight,
      canvasYOffset: 0,
    };

    // Pre-multiply color with alpha for grid lines
    const gridLineColorWithAlpha = applyAlphaToColor(this.gridLineColor, gridAlpha);

    let rectIndex = 0;
    const hasSubMsTicks = tickInterval.interval < NS_PER_MS;

    // Notify strategy of frame start
    this.strategy.beginFrame(tickInterval, firstTickIndex, firstTickIndex * tickInterval.interval);

    // Bind getOrCreateLabel for the strategy
    const getOrCreateLabel = (text: string): Text => this.getOrCreateLabel(text);

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

      // Draw vertical line as 1px wide rectangle (full height)
      this.geometry.writeRectangle(
        rectIndex,
        pixelX,
        0,
        1,
        effectiveHeight,
        gridLineColorWithAlpha,
        viewportTransform,
      );
      rectIndex++;

      // Add label at top if requested (only when showLabels is enabled)
      if (showLabels && shouldShowLabel && this.screenSpaceContainer) {
        const screenSpaceX = screenX - viewport.offsetX;
        this.strategy.renderTickLabel(time, screenSpaceX, getOrCreateLabel, i);
      }
    }

    // Set draw count and make visible
    this.geometry.setDrawCount(rectIndex);
    this.mesh.visible = true;

    // Notify strategy of frame end
    this.strategy.endFrame(this.screenSpaceContainer, hasSubMsTicks);
  }

  // ============================================================================
  // PRIVATE: LABEL MANAGEMENT
  // ============================================================================

  /**
   * Get or create a PIXI.Text label from the pool.
   * Uses index-based pooling so the same text can appear at multiple positions.
   */
  private getOrCreateLabel(text: string): Text {
    const index = this.activeLabelCount++;
    let label = this.labelPool[index];

    if (!label) {
      label = new Text({
        text,
        style: {
          fontFamily: 'monospace',
          fontSize: this.config.fontSize,
          fill: this.config.textColor,
        },
      });
      this.labelPool.push(label);
      this.labelsContainer.addChild(label);
    } else {
      label.text = text;
    }

    label.visible = true;
    return label;
  }

  /**
   * Hide all labels (for next render pass).
   */
  private clearLabels(): void {
    for (let i = 0; i < this.activeLabelCount; i++) {
      this.labelPool[i]!.visible = false;
    }
    this.activeLabelCount = 0;
    // Strategy handles its own label cleanup (e.g., sticky label) in beginFrame
  }

  // ============================================================================
  // PRIVATE: UTILITIES
  // ============================================================================

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
}

// ============================================================================
// MODULE-LEVEL UTILITIES
// ============================================================================

/**
 * Apply alpha to a color by pre-multiplying into ABGR format for the shader.
 * The shader expects colors in ABGR format with alpha in the high byte.
 */
function applyAlphaToColor(color: number, alpha: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  if (alpha >= 1.0) {
    return (0xff << 24) | (b << 16) | (g << 8) | r;
  }
  const a = Math.round(alpha * 255);
  return (a << 24) | (b << 16) | (g << 8) | r;
}

/**
 * Select appropriate interval using 1-2-5 sequence.
 * Returns interval in milliseconds and skip factor for label density.
 */
function selectInterval(targetMs: number): { interval: number; skipFactor: number } {
  const baseIntervals = [
    // Sub-millisecond (microseconds in ms)
    0.001, 0.002, 0.005,
    // Tens of microseconds
    0.01, 0.02, 0.05,
    // Hundreds of microseconds
    0.1, 0.2, 0.5,
    // Milliseconds
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    // Seconds
    1000, 2000, 5000, 10000,
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
    if (targetMs > interval * 1.5) {
      skipFactor = 2;
    }
    if (targetMs > interval * 3) {
      skipFactor = 5;
    }
  }

  return { interval, skipFactor };
}
