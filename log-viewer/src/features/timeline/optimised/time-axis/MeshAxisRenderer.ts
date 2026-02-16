/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MeshAxisRenderer
 *
 * Renders time scale axis with dynamic labels and tick marks using PixiJS Mesh.
 * Adapts tick density and label precision based on zoom level.
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

import { Container, Geometry, Graphics, Mesh, Shader, Text } from 'pixi.js';
import { formatWallClockTime } from '../../../../core/utility/Util.js';
import type { ViewportState } from '../../types/flamechart.types.js';
import { RectangleGeometry, type ViewportTransform } from '../RectangleGeometry.js';
import { createRectangleShader } from '../RectangleShader.js';

/**
 * Nanoseconds per millisecond conversion constant.
 */
const NS_PER_MS = 1_000_000;

/**
 * Padding around the sticky label in pixels.
 */
const STICKY_PADDING_X = 4;
const STICKY_PADDING_Y = 2;
const STICKY_LEFT_X = 4;
const STICKY_TOP_Y = 5;

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
interface TickInterval {
  /** Interval duration in nanoseconds */
  interval: number;
  /** Skip factor (1 = show all, 2 = show every 2nd, 5 = show every 5th) */
  skipFactor: number;
}

export class MeshAxisRenderer {
  private parentContainer: Container;
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

  /** Time display mode: 'elapsed' (default) or 'wallClock' */
  private displayMode: 'elapsed' | 'wallClock' = 'elapsed';
  /** Wall-clock time of the first event in ms since midnight (for wallClock mode) */
  private startTimeMs = 0;
  /** Nanosecond timestamp of the first event (for wallClock mode) */
  private firstTimestampNs = 0;

  /** Sticky label: persistent text pinned to left edge showing last off-screen anchor */
  private stickyText: Text | null = null;
  /** Sticky label background rectangle */
  private stickyBackground: Graphics | null = null;

  constructor(container: Container, config?: Partial<AxisConfig>) {
    this.parentContainer = container;

    // Default configuration
    this.config = {
      height: 30,
      lineColor: 0x808080, // Medium gray that works in light and dark themes
      textColor: '#808080', // Medium gray that works in light and dark themes
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

    // Render tick marks (vertical lines from top to bottom, behind rectangles)
    this.renderTicks(viewport, timeStart, timeEnd, tickInterval, gridHeight);
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

    // Update sticky label colors
    if (this.stickyText) {
      this.stickyText.style.fill = this.config.textColor;
    }
    this.updateStickyBackground();
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
    this.displayMode = mode;
    this.startTimeMs = startTimeMs;
    this.firstTimestampNs = firstTimestampNs;
  }

  /**
   * Apply alpha to a color by pre-multiplying into ABGR format for the shader.
   * The shader expects colors in ABGR format with alpha in the high byte.
   */
  private applyAlphaToColor(color: number, alpha: number): number {
    if (alpha >= 1.0) {
      // Full alpha - pack as opaque ABGR
      const r = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const b = color & 0xff;
      return (0xff << 24) | (b << 16) | (g << 8) | r;
    }
    // Pre-multiply alpha into ABGR format
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const a = Math.round(alpha * 255);
    return (a << 24) | (b << 16) | (g << 8) | r;
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
   * Clean up resources.
   */
  public destroy(): void {
    this.geometry.destroy();
    this.mesh.destroy();
    this.labelsContainer.destroy();
    this.labelPool.length = 0;
    this.activeLabelCount = 0;

    if (this.stickyText) {
      this.stickyText.destroy();
      this.stickyText = null;
    }
    if (this.stickyBackground) {
      this.stickyBackground.destroy();
      this.stickyBackground = null;
    }
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
      // In wall-clock mode every tick gets a label (wall-clock or relative),
      // so never skip ticks
      skipFactor: this.displayMode === 'wallClock' ? 1 : skipFactor,
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
    const gridLineColorWithAlpha = this.applyAlphaToColor(this.gridLineColor, gridAlpha);

    let rectIndex = 0;

    const isWallClockDisplay = this.displayMode === 'wallClock';

    // Wall-clock per-tick tracking: show wall-clock time when the integer ms
    // differs from the previous tick, otherwise show a relative offset.
    let previousWallClockMsInt = -1;
    let previousAnchorTime = 0;
    let lastOffscreenAnchorTime: number | null = null;
    let preComputedAnchorIdx = -1;

    if (isWallClockDisplay) {
      // Pre-compute anchor state so the first tick in the loop is correctly
      // classified as wall-clock vs relative. Without this, the first tick
      // always becomes an anchor (because previousWallClockMsInt starts at -1),
      // causing relative labels to vanish on the left side of the viewport.
      //
      // Find the ms value for the first tick, then compute where that ms run
      // starts by finding the ms boundary (where Math.round transitions).
      const firstTime = firstTickIndex * tickInterval.interval;
      const firstMs = Math.round(
        this.startTimeMs + (firstTime - this.firstTimestampNs) / NS_PER_MS,
      );

      // The ms boundary is where wallClockMs = firstMs - 0.5 (Math.round rounds .5 up).
      // Convert back to nanoseconds to find the anchor tick.
      const msBoundaryNs = (firstMs - 0.5 - this.startTimeMs) * NS_PER_MS + this.firstTimestampNs;
      const anchorTickIndex = Math.ceil(msBoundaryNs / tickInterval.interval);

      previousWallClockMsInt = firstMs;
      previousAnchorTime = anchorTickIndex * tickInterval.interval;
      preComputedAnchorIdx = anchorTickIndex;

      // If the pre-computed anchor is before the loop range it won't get a label,
      // so track it here for the sticky label.
      if (anchorTickIndex < firstTickIndex) {
        lastOffscreenAnchorTime = previousAnchorTime;
      }
    }

    // Track visible labels for collision detection with sticky label
    const visibleLabels: { label: Text; isAnchor: boolean }[] = [];
    const hasSubMsTicks = tickInterval.interval < NS_PER_MS;

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
        let labelText: string;
        let isAnchorLabel = false;

        if (isWallClockDisplay) {
          // Per-tick decision: show wall-clock time when the rounded ms is
          // unique (different from the previous tick), otherwise show a
          // relative offset from the last unique-ms tick.
          //
          // Math.round matches formatWallClockTime's internal Math.round(ms % 1000),
          // so the classification is consistent with the formatted output.
          const wallClockMs = this.startTimeMs + (time - this.firstTimestampNs) / NS_PER_MS;
          const wallClockMsInt = Math.round(wallClockMs);

          if (wallClockMsInt !== previousWallClockMsInt || i === preComputedAnchorIdx) {
            // Unique ms (or pre-computed anchor) — show wall-clock label
            previousWallClockMsInt = wallClockMsInt;
            previousAnchorTime = time;
            labelText = this.formatWallClockTimeTrimmed(wallClockMs);
            isAnchorLabel = true;
          } else {
            // Same ms as previous tick — show relative offset
            labelText = this.formatRelativeOffset(time - previousAnchorTime);
          }
        } else {
          // Elapsed mode
          const timeMs = time / NS_PER_MS;
          labelText = this.formatMilliseconds(timeMs);
        }

        if (labelText) {
          const label = this.getOrCreateLabel(labelText);
          label.x = screenSpaceX - 3;
          label.y = 5;
          label.anchor.set(1, 0);

          if (isWallClockDisplay) {
            if (isAnchorLabel) {
              const labelLeftEdge = label.x - this.estimateMonospaceWidth(labelText);
              if (labelLeftEdge < 0) {
                // Anchor is being clipped — sticky replaces it
                lastOffscreenAnchorTime = time;
                label.visible = false;
              } else {
                visibleLabels.push({ label, isAnchor: true });
              }
            } else {
              visibleLabels.push({ label, isAnchor: false });
            }
          }
        }
      }
    }

    // Set draw count and make visible
    this.geometry.setDrawCount(rectIndex);
    this.mesh.visible = true;

    // Update sticky label for wall-clock relative mode
    this.updateStickyLabel(lastOffscreenAnchorTime, visibleLabels, hasSubMsTicks);
  }

  // ============================================================================
  // PRIVATE: STICKY LABEL
  // ============================================================================

  /**
   * Update the sticky anchor label pinned to the left edge.
   * Shows the wall-clock time of the last off-screen anchor.
   */
  private updateStickyLabel(
    lastOffscreenAnchorTime: number | null,
    visibleLabels: { label: Text; isAnchor: boolean }[],
    hasSubMsTicks: boolean,
  ): void {
    // Only show sticky when sub-ms ticks exist (relative labels between anchors).
    // At lower zoom every tick is an anchor so sticky adds no value.
    if (!lastOffscreenAnchorTime || !this.screenSpaceContainer || !hasSubMsTicks) {
      this.hideStickyLabel();
      return;
    }

    const stickyTimeText = this.formatWallClockTimeTrimmed(
      this.startTimeMs + (lastOffscreenAnchorTime - this.firstTimestampNs) / NS_PER_MS,
    );

    // Create or update sticky text
    if (!this.stickyText) {
      this.stickyText = new Text({
        text: stickyTimeText,
        style: {
          fontFamily: 'monospace',
          fontSize: this.config.fontSize,
          fill: this.config.textColor,
        },
      });
      this.stickyText.anchor.set(0, 0);
      // Sticky label renders on top (added after regular labels container)
      this.screenSpaceContainer.addChild(this.stickyText);
    } else {
      this.stickyText.text = stickyTimeText;
    }

    this.stickyText.x = STICKY_LEFT_X + STICKY_PADDING_X;
    this.stickyText.y = STICKY_TOP_Y;
    this.stickyText.visible = true;

    // Create or update sticky background
    if (!this.stickyBackground) {
      this.stickyBackground = new Graphics();
      // Insert background before text so text renders on top
      const textIndex = this.screenSpaceContainer.getChildIndex(this.stickyText);
      this.screenSpaceContainer.addChildAt(this.stickyBackground, textIndex);
    }
    this.updateStickyBackground();
    this.stickyBackground.visible = true;

    // Collision detection: handle overlapping labels near the sticky.
    // - Relative labels yield to the sticky (hidden).
    // - Anchor labels cause the sticky to yield (sticky hidden) since
    //   the anchor provides more relevant context as it scrolls past.
    const stickyRightEdge = STICKY_LEFT_X + this.stickyText.width + STICKY_PADDING_X * 2 + 4;

    for (const { label, isAnchor } of visibleLabels) {
      // Labels are right-anchored, so left edge = label.x - label.width
      const labelLeftEdge = label.x - label.width;
      if (labelLeftEdge < stickyRightEdge) {
        if (isAnchor) {
          // Anchor approaching — hide sticky so anchor stays visible
          this.hideStickyLabel();
          break;
        }
        label.visible = false;
      }
    }
  }

  /**
   * Redraw the sticky label background rectangle.
   */
  private updateStickyBackground(): void {
    if (!this.stickyBackground || !this.stickyText || !this.stickyText.visible) {
      return;
    }

    this.stickyBackground.clear();

    const bgColor = this.getStickyBackgroundColor();
    const width = this.stickyText.width + STICKY_PADDING_X * 2;
    const height = this.stickyText.height + STICKY_PADDING_Y * 2;

    this.stickyBackground.roundRect(
      STICKY_LEFT_X,
      STICKY_TOP_Y - STICKY_PADDING_Y,
      width,
      height,
      2,
    );
    this.stickyBackground.fill({ color: bgColor, alpha: 0.85 });
  }

  /**
   * Get background color for sticky label from CSS variables.
   */
  private getStickyBackgroundColor(): number {
    const computedStyle = getComputedStyle(document.documentElement);
    const bgStr = computedStyle.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    return this.parseColorToHex(bgStr);
  }

  /**
   * Hide the sticky label and background.
   */
  private hideStickyLabel(): void {
    if (this.stickyText) {
      this.stickyText.visible = false;
    }
    if (this.stickyBackground) {
      this.stickyBackground.visible = false;
    }
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
    this.hideStickyLabel();
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

  /**
   * Format wall-clock time for axis labels, trimming trailing zeros from milliseconds.
   * e.g., "10:35:55.100" → "10:35:55.1", "10:35:55.000" → "10:35:55"
   */
  private formatWallClockTimeTrimmed(ms: number): string {
    const raw = formatWallClockTime(ms);
    // raw format: "HH:mm:ss.SSS" — trim trailing zeros from the ms portion
    return raw.replace(/\.?0+$/, '');
  }

  /**
   * Format a relative offset in nanoseconds as "+N ms" or "+N s".
   * Uses smart decimal trimming (no trailing zeros).
   */
  private estimateMonospaceWidth(text: string): number {
    return text.length * this.config.fontSize * 0.6;
  }

  private formatRelativeOffset(offsetNs: number): string {
    if (offsetNs === 0) {
      return '';
    }

    const offsetMs = offsetNs / NS_PER_MS;

    // For offsets >= 1s, show in seconds
    if (offsetMs >= 1000) {
      const seconds = offsetMs / 1000;
      const formatted = seconds.toFixed(3).replace(/\.?0+$/, '');
      return `+${formatted} s`;
    }

    // Show in milliseconds with smart decimal trimming
    const formatted = offsetMs.toFixed(3).replace(/\.?0+$/, '');
    return `+${formatted} ms`;
  }
}
