/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapRenderer
 *
 * PIXI.js renderer for the timeline minimap visualization.
 * Renders skyline area chart, viewport lens, 2D curtain effect, markers, and cursor mirror.
 *
 * Visual design:
 * - Skyline (area chart): Filled polygon where Y=depth and opacity=log(density)
 * - 2D Curtain effect: Semi-transparent overlay outside the viewport lens (X and Y)
 * - Lens borders: Rectangular window with draggable edges
 * - Marker bands: Colored vertical bands from main timeline
 * - Cursor line: Vertical guide mirroring cursor from other view
 *
 * Performance architecture:
 * - Static layers (background, skyline, markers, axis): Cached as RenderTexture
 * - Dynamic layers (curtain, lens, cursor): Redrawn every frame
 * - Static content only invalidated on resize, data change, or theme change
 *
 * Performance requirements:
 * - Reuse Graphics objects (clear() instead of destroy/recreate)
 * - <2ms full render during pan/zoom (dynamic layers only)
 */

import * as PIXI from 'pixi.js';
import type { TimelineMarker } from '../../types/flamechart.types.js';
import { MARKER_COLORS } from '../../types/flamechart.types.js';
import { MinimapAxisRenderer } from './MinimapAxisRenderer.js';
import type { MinimapDensityData } from './MinimapDensityQuery.js';
import type { MinimapManager, MinimapSelection } from './MinimapManager.js';

/**
 * Opacity constants for density visualization (logarithmic scale).
 */
const MIN_OPACITY = 0.5;
const MAX_OPACITY = 1.0;
const SATURATION_COUNT = 100;

/**
 * Curtain overlay opacity (outside viewport lens).
 */
const CURTAIN_OPACITY = 0.5;

/**
 * Edge handle width in pixels.
 */
const EDGE_HANDLE_WIDTH = 2;

/**
 * Cursor line width and color.
 */
const CURSOR_LINE_WIDTH = 1;
const CURSOR_LINE_COLOR = 0xffffff;
const CURSOR_LINE_OPACITY = 0.6;

/**
 * Default colors extracted from CSS variables (VS Code theme compatible).
 */
interface MinimapColors {
  /** Curtain overlay color. */
  curtain: number;
  /** Lens border color. */
  lensBorder: number;
  /** Edge handle color (on hover/drag). */
  edgeHandle: number;
}

export class MinimapRenderer {
  /** Container for all minimap graphics. */
  private container: PIXI.Container;

  // ============================================================================
  // STATIC CONTENT (cached as RenderTexture, redrawn only on invalidation)
  // ============================================================================

  /** Container for static content (rendered to texture). */
  private staticContainer: PIXI.Container;

  /** Background rectangle. */
  private backgroundGraphics: PIXI.Graphics;

  /** Skyline area chart (replaces density bars). */
  private skylineGraphics: PIXI.Graphics;

  /** Marker bands from main timeline. */
  private markerGraphics: PIXI.Graphics;

  /** Time axis renderer (static). */
  private axisRenderer: MinimapAxisRenderer;

  /** Cached render texture for static content. */
  private staticTexture: PIXI.RenderTexture | null = null;

  /** Sprite displaying the cached static texture. */
  private staticSprite: PIXI.Sprite | null = null;

  /** Flag indicating static content needs redraw. */
  private staticDirty = true;

  /** Cached display width for invalidation detection. */
  private cachedDisplayWidth = 0;

  /** Cached display height for invalidation detection. */
  private cachedDisplayHeight = 0;

  // ============================================================================
  // DYNAMIC CONTENT (redrawn every frame)
  // ============================================================================

  /** Container for dynamic content (curtain, lens, cursor). */
  private dynamicContainer: PIXI.Container;

  /** 2D Curtain overlay (dimmed area outside lens in X and Y). */
  private curtainGraphics: PIXI.Graphics;

  /** Viewport lens borders. */
  private lensGraphics: PIXI.Graphics;

  /** Cursor mirror line. */
  private cursorLineGraphics: PIXI.Graphics;

  // ============================================================================
  // OTHER STATE
  // ============================================================================

  /** Cached colors from CSS variables. */
  private colors: MinimapColors;

  /** Reference to PIXI renderer for texture rendering. */
  private renderer: PIXI.Renderer | null = null;

  /**
   * @param parentContainer - PIXI container to add minimap graphics to
   */
  constructor(parentContainer: PIXI.Container) {
    // Create main container at top of stage
    this.container = new PIXI.Container();
    this.container.position.set(0, 0);
    parentContainer.addChild(this.container);

    // ============================================================================
    // STATIC CONTENT SETUP
    // ============================================================================

    // Container for static content (will be rendered to texture)
    this.staticContainer = new PIXI.Container();

    // Static graphics layers
    this.backgroundGraphics = new PIXI.Graphics();
    this.skylineGraphics = new PIXI.Graphics();
    this.markerGraphics = new PIXI.Graphics();

    // Add static layers to static container
    this.staticContainer.addChild(this.backgroundGraphics);
    this.staticContainer.addChild(this.skylineGraphics);
    this.staticContainer.addChild(this.markerGraphics);

    // Axis renderer (renders into static container)
    this.axisRenderer = new MinimapAxisRenderer(this.staticContainer);

    // ============================================================================
    // DYNAMIC CONTENT SETUP
    // ============================================================================

    // Container for dynamic content
    this.dynamicContainer = new PIXI.Container();

    // Dynamic graphics layers
    this.curtainGraphics = new PIXI.Graphics();
    this.lensGraphics = new PIXI.Graphics();
    this.cursorLineGraphics = new PIXI.Graphics();

    // Add dynamic layers
    this.dynamicContainer.addChild(this.curtainGraphics);
    this.dynamicContainer.addChild(this.lensGraphics);
    this.dynamicContainer.addChild(this.cursorLineGraphics);

    // Add to main container (static sprite will be added when first rendered)
    this.container.addChild(this.dynamicContainer);

    // Extract colors from CSS variables
    this.colors = this.extractColors();
  }

  /**
   * Set the PIXI renderer for texture caching.
   * Must be called before render() to enable static content caching.
   */
  public setRenderer(renderer: PIXI.Renderer): void {
    this.renderer = renderer;
  }

  /**
   * Get the minimap container.
   */
  public getContainer(): PIXI.Container {
    return this.container;
  }

  /**
   * Invalidate static content cache.
   * Call this when minimap data, size, or theme changes.
   */
  public invalidateStatic(): void {
    this.staticDirty = true;
  }

  /**
   * Render the complete minimap.
   *
   * Uses two-pass rendering for performance:
   * 1. Static pass: Only when invalidated (resize, data change, theme change)
   * 2. Dynamic pass: Every frame (curtain, lens, cursor)
   *
   * @param manager - MinimapManager with state
   * @param densityData - Density data for skyline
   * @param markers - Timeline markers to display
   * @param batchColors - Category colors from theme
   * @param cursorTimeNs - Cursor position in nanoseconds (null to hide cursor line)
   */
  public render(
    manager: MinimapManager,
    densityData: MinimapDensityData,
    markers: TimelineMarker[],
    batchColors: Map<string, { color: number }>,
    cursorTimeNs: number | null,
  ): void {
    const state = manager.getState();
    const selection = manager.getSelection();

    // Check if display size changed (auto-invalidate)
    if (
      state.displayWidth !== this.cachedDisplayWidth ||
      state.height !== this.cachedDisplayHeight
    ) {
      this.staticDirty = true;
      this.cachedDisplayWidth = state.displayWidth;
      this.cachedDisplayHeight = state.height;
    }

    // Render static content to texture if dirty
    if (this.staticDirty) {
      this.renderStaticContent(manager, densityData, markers, batchColors);
      this.staticDirty = false;
    }

    // Always render dynamic content
    this.renderDynamicContent(manager, selection, cursorTimeNs);
  }

  /**
   * Render static content (background, skyline, markers, axis).
   * This is cached as a RenderTexture for performance.
   */
  private renderStaticContent(
    manager: MinimapManager,
    densityData: MinimapDensityData,
    markers: TimelineMarker[],
    batchColors: Map<string, { color: number }>,
  ): void {
    const state = manager.getState();
    const minimapHeight = state.height;
    const displayWidth = state.displayWidth;

    // Clear static graphics
    this.backgroundGraphics.clear();
    this.skylineGraphics.clear();
    this.markerGraphics.clear();

    // Render skyline area chart
    this.renderSkyline(manager, densityData, batchColors, minimapHeight);

    // Render markers
    this.renderMarkers(manager, markers, minimapHeight);

    // Render time axis
    this.axisRenderer.render(manager);

    // If we have a renderer, cache to texture
    if (this.renderer && displayWidth > 0 && minimapHeight > 0) {
      // Create or resize texture
      if (
        !this.staticTexture ||
        this.staticTexture.width !== displayWidth ||
        this.staticTexture.height !== minimapHeight
      ) {
        if (this.staticTexture) {
          this.staticTexture.destroy(true);
        }
        // Create texture at device pixel ratio for crisp rendering
        const resolution = this.renderer.resolution;
        this.staticTexture = PIXI.RenderTexture.create({
          width: displayWidth,
          height: minimapHeight,
          resolution,
        });

        // Create sprite if needed
        if (!this.staticSprite) {
          this.staticSprite = new PIXI.Sprite(this.staticTexture);
          // Insert sprite at beginning of container (behind dynamic content)
          this.container.addChildAt(this.staticSprite, 0);
        } else {
          this.staticSprite.texture = this.staticTexture;
        }
      }

      // Render static container to texture
      this.renderer.render({
        container: this.staticContainer,
        target: this.staticTexture,
        clear: true,
      });
    }
  }

  /**
   * Render dynamic content (curtain, lens, cursor).
   * Called every frame during pan/zoom.
   */
  private renderDynamicContent(
    manager: MinimapManager,
    selection: Readonly<MinimapSelection>,
    cursorTimeNs: number | null,
  ): void {
    const state = manager.getState();
    const minimapHeight = state.height;

    // Clear dynamic graphics
    this.curtainGraphics.clear();
    this.lensGraphics.clear();
    this.cursorLineGraphics.clear();

    // Render 2D curtain (dimmed overlay outside lens in X and Y)
    this.render2DCurtain(manager, selection, minimapHeight);

    // Render lens borders (viewport indicator)
    this.renderLens(manager, selection, minimapHeight);

    // Render cursor mirror line
    if (cursorTimeNs !== null) {
      this.renderCursorLine(manager, cursorTimeNs, minimapHeight);
    }
  }

  /**
   * Render skyline area chart (filled polygon).
   * Creates a smooth filled area where:
   * - X-axis = time position
   * - Y-axis = stack depth (normalized)
   * - Color = dominant category
   * - Opacity = event density (logarithmic scale)
   */
  private renderSkyline(
    manager: MinimapManager,
    densityData: MinimapDensityData,
    batchColors: Map<string, { color: number }>,
    minimapHeight: number,
  ): void {
    const state = manager.getState();
    const { buckets, globalMaxDepth } = densityData;

    // Axis is at TOP - chart area is below it
    const axisHeight = this.axisRenderer.getHeight();
    const _chartTop = axisHeight; // Chart starts below axis (unused, kept for documentation)
    const chartHeight = minimapHeight - axisHeight;
    const chartBottom = minimapHeight; // Chart ends at bottom of minimap

    if (globalMaxDepth === 0 || buckets.length === 0 || chartHeight <= 0) {
      return;
    }

    const bucketWidth = state.displayWidth / buckets.length;

    // Group consecutive buckets by dominant category for smoother rendering
    let currentCategory: string | null = null;
    let polygonPoints: number[] = [];
    let lastValidX = 0;
    let currentColor = 0x808080;
    let currentOpacity = 0.5;

    const flushPolygon = () => {
      if (polygonPoints.length >= 4) {
        // Close polygon: add bottom-right, then bottom-left
        polygonPoints.push(lastValidX, chartBottom);

        // Draw filled polygon
        this.skylineGraphics.poly(polygonPoints);
        this.skylineGraphics.fill({ color: currentColor, alpha: currentOpacity });
      }
      polygonPoints = [];
    };

    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]!;
      const x = i * bucketWidth;

      if (bucket.eventCount === 0) {
        // Gap in data - flush current polygon if any
        if (polygonPoints.length > 0) {
          flushPolygon();
        }
        currentCategory = null;
        continue;
      }

      // Calculate height from normalized depth
      // heightRatio 0 = baseline (bottom), heightRatio 1 = full height (top of chart)
      const heightRatio = globalMaxDepth > 0 ? bucket.maxDepth / globalMaxDepth : 0;
      const y = chartBottom - heightRatio * chartHeight;

      // Calculate opacity from event count
      const opacity = this.calculateDensityOpacity(bucket.eventCount);

      // Get color from batch colors
      const colorInfo = batchColors.get(bucket.dominantCategory);
      const color = colorInfo?.color ?? 0x808080;

      // Check if category changed
      if (bucket.dominantCategory !== currentCategory) {
        // Flush previous polygon
        if (polygonPoints.length > 0) {
          flushPolygon();
        }

        // Start new polygon with bottom-left corner
        currentCategory = bucket.dominantCategory;
        currentColor = color;
        currentOpacity = opacity;
        polygonPoints.push(x, chartBottom);
      }

      // Add point to current polygon
      polygonPoints.push(x, y);
      polygonPoints.push(x + bucketWidth, y);
      lastValidX = x + bucketWidth;

      // Update opacity (use max opacity for smoothness)
      if (opacity > currentOpacity) {
        currentOpacity = opacity;
      }
    }

    // Flush final polygon
    flushPolygon();
  }

  /**
   * Calculate opacity based on event count using logarithmic scale.
   * 1 event = ~41%, 100+ events = ~70%.
   */
  private calculateDensityOpacity(eventCount: number): number {
    if (eventCount <= 0) {
      return 0;
    }

    const normalized = Math.min(eventCount / SATURATION_COUNT, 1);
    // Logarithmic curve: log10(x * 9 + 1) maps 0-1 to 0-1 with log shape
    const logScale = Math.log10(normalized * 9 + 1);
    return MIN_OPACITY + (MAX_OPACITY - MIN_OPACITY) * logScale;
  }

  /**
   * Render markers as colored vertical bands.
   */
  private renderMarkers(
    manager: MinimapManager,
    markers: TimelineMarker[],
    minimapHeight: number,
  ): void {
    const state = manager.getState();

    // Axis is at TOP - chart area is below it
    const axisHeight = this.axisRenderer.getHeight();
    const chartTop = axisHeight;
    const chartHeight = minimapHeight - axisHeight;

    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i]!;

      // Calculate marker bounds
      const startX = manager.timeToMinimapX(marker.startTime);

      // Marker extends to next marker or end of timeline
      const nextMarker = markers[i + 1];
      const endTime = nextMarker?.startTime ?? state.totalDuration;
      const endX = manager.timeToMinimapX(endTime);

      // Get marker color
      const color = MARKER_COLORS[marker.type] ?? 0x808080;

      // Draw marker band (full height of chart area below axis)
      this.markerGraphics.rect(startX, chartTop, Math.max(1, endX - startX), chartHeight);
      this.markerGraphics.fill({ color, alpha: 0.3 });
    }
  }

  /**
   * Render 2D curtain overlay (dimmed area outside the viewport lens).
   * Dims in both X (time) and Y (depth) directions.
   *
   * IMPORTANT: The curtain covers only the CHART AREA (below the axis).
   * The axis area (Y=0 to Y=axisHeight) is NOT dimmed to keep labels crisp.
   * This prevents the 50% opacity curtain from making axis labels appear dull.
   */
  private render2DCurtain(
    manager: MinimapManager,
    selection: Readonly<MinimapSelection>,
    minimapHeight: number,
  ): void {
    const state = manager.getState();

    // Axis is at TOP - chart area is below it
    const axisHeight = this.axisRenderer.getHeight();
    const chartTop = axisHeight;
    const chartBottom = minimapHeight;
    const chartHeight = chartBottom - chartTop;

    // Calculate lens X bounds (time)
    const lensX1 = manager.timeToMinimapX(selection.startTime);
    const lensX2 = manager.timeToMinimapX(selection.endTime);

    // Calculate lens Y bounds (depth)
    // depthToMinimapY returns Y in [axisHeight, minimapHeight] with inverted depth
    // depthStart (shallower) → larger Y (closer to bottom of chart)
    // depthEnd (deeper) → smaller Y (closer to top of chart, just below axis)
    const lensY1 = manager.depthToMinimapY(selection.depthEnd); // Top of lens (deeper = closer to axis)
    const lensY2 = manager.depthToMinimapY(selection.depthStart); // Bottom of lens (shallower = closer to bottom)

    // Clamp lens Y to chart area (not into axis area at top)
    const clampedLensY1 = Math.max(chartTop, Math.min(chartBottom, lensY1));
    const clampedLensY2 = Math.max(chartTop, Math.min(chartBottom, lensY2));

    // Draw 4 curtain regions (L-shaped around the lens window)
    // Curtain covers ONLY the chart area (Y=axisHeight to Y=minimapHeight)
    // Axis area (Y=0 to Y=axisHeight) is NOT covered to keep labels crisp

    // Left curtain (chart area only, excludes axis)
    if (lensX1 > 0) {
      this.curtainGraphics.rect(0, chartTop, lensX1, chartHeight);
      this.curtainGraphics.fill({ color: this.colors.curtain, alpha: CURTAIN_OPACITY });
    }

    // Right curtain (chart area only, excludes axis)
    if (lensX2 < state.displayWidth) {
      this.curtainGraphics.rect(lensX2, chartTop, state.displayWidth - lensX2, chartHeight);
      this.curtainGraphics.fill({ color: this.colors.curtain, alpha: CURTAIN_OPACITY });
    }

    // Top curtain (between left and right curtains, from top of chart area to top of lens)
    // Note: This now starts at chartTop (axisHeight), not 0
    if (clampedLensY1 > chartTop) {
      this.curtainGraphics.rect(lensX1, chartTop, lensX2 - lensX1, clampedLensY1 - chartTop);
      this.curtainGraphics.fill({ color: this.colors.curtain, alpha: CURTAIN_OPACITY });
    }

    // Bottom curtain (between left and right curtains, below lens to bottom of minimap)
    if (clampedLensY2 < minimapHeight) {
      this.curtainGraphics.rect(
        lensX1,
        clampedLensY2,
        lensX2 - lensX1,
        minimapHeight - clampedLensY2,
      );
      this.curtainGraphics.fill({ color: this.colors.curtain, alpha: CURTAIN_OPACITY });
    }
  }

  /**
   * Render viewport lens borders (rectangular window).
   */
  private renderLens(
    manager: MinimapManager,
    selection: Readonly<MinimapSelection>,
    minimapHeight: number,
  ): void {
    // Axis is at TOP - chart area is below it
    const axisHeight = this.axisRenderer.getHeight();
    const chartTop = axisHeight;
    const chartBottom = minimapHeight;

    // Calculate lens bounds
    const lensX1 = manager.timeToMinimapX(selection.startTime);
    const lensX2 = manager.timeToMinimapX(selection.endTime);

    // depthToMinimapY returns Y in [axisHeight, minimapHeight] with inverted depth
    // depthStart (shallower) → larger Y, depthEnd (deeper) → smaller Y
    const lensY1 = manager.depthToMinimapY(selection.depthEnd); // Top of lens
    const lensY2 = manager.depthToMinimapY(selection.depthStart); // Bottom of lens

    // Clamp lens Y to chart area (not into axis at top)
    const clampedLensY1 = Math.max(chartTop, Math.min(chartBottom, lensY1));
    const clampedLensY2 = Math.max(chartTop, Math.min(chartBottom, lensY2));

    const lensWidth = lensX2 - lensX1;
    const lensHeight = clampedLensY2 - clampedLensY1;

    // Left edge handle
    this.lensGraphics.rect(
      lensX1 - EDGE_HANDLE_WIDTH / 2,
      clampedLensY1,
      EDGE_HANDLE_WIDTH,
      lensHeight,
    );
    this.lensGraphics.fill({ color: this.colors.lensBorder, alpha: 0.8 });

    // Right edge handle
    this.lensGraphics.rect(
      lensX2 - EDGE_HANDLE_WIDTH / 2,
      clampedLensY1,
      EDGE_HANDLE_WIDTH,
      lensHeight,
    );
    this.lensGraphics.fill({ color: this.colors.lensBorder, alpha: 0.8 });

    // Top border
    this.lensGraphics.rect(lensX1, clampedLensY1, lensWidth, 1);
    this.lensGraphics.fill({ color: this.colors.lensBorder, alpha: 0.5 });

    // Bottom border
    this.lensGraphics.rect(lensX1, clampedLensY2 - 1, lensWidth, 1);
    this.lensGraphics.fill({ color: this.colors.lensBorder, alpha: 0.5 });
  }

  /**
   * Render cursor mirror line.
   */
  private renderCursorLine(
    manager: MinimapManager,
    cursorTimeNs: number,
    minimapHeight: number,
  ): void {
    const x = manager.timeToMinimapX(cursorTimeNs);

    // Axis is at TOP - cursor spans chart area below it
    const axisHeight = this.axisRenderer.getHeight();
    const chartTop = axisHeight;
    const chartHeight = minimapHeight - axisHeight;

    this.cursorLineGraphics.rect(
      x - CURSOR_LINE_WIDTH / 2,
      chartTop,
      CURSOR_LINE_WIDTH,
      chartHeight,
    );
    this.cursorLineGraphics.fill({ color: CURSOR_LINE_COLOR, alpha: CURSOR_LINE_OPACITY });
  }

  /**
   * Extract colors from CSS variables.
   */
  private extractColors(): MinimapColors {
    const computedStyle = getComputedStyle(document.documentElement);

    // Curtain - slightly lighter than background for visibility
    const curtainStr =
      computedStyle.getPropertyValue('--vscode-editorWidget-background').trim() || '#252526';

    // Lens border - use focus/selection color
    const borderStr = computedStyle.getPropertyValue('--vscode-focusBorder').trim() || '#007fd4';

    return {
      curtain: this.parseColorToHex(curtainStr),
      lensBorder: this.parseColorToHex(borderStr),
      edgeHandle: this.parseColorToHex(borderStr),
    };
  }

  /**
   * Parse CSS color string to numeric hex (RGB only).
   */
  private parseColorToHex(cssColor: string): number {
    if (!cssColor) {
      return 0x1e1e1e; // Default dark
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

    return 0x1e1e1e; // Default dark
  }

  /**
   * Refresh colors from CSS variables (e.g., after VS Code theme change).
   * Also invalidates static content to trigger re-render with new colors.
   */
  public refreshColors(): void {
    this.colors = this.extractColors();

    // Refresh axis renderer colors
    this.axisRenderer.refreshColors();

    this.invalidateStatic();
  }

  /**
   * Clear all graphics.
   */
  public clear(): void {
    this.backgroundGraphics.clear();
    this.skylineGraphics.clear();
    this.markerGraphics.clear();
    this.curtainGraphics.clear();
    this.lensGraphics.clear();
    this.cursorLineGraphics.clear();
    this.axisRenderer.clear();
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    // Destroy static content
    this.backgroundGraphics.destroy();
    this.skylineGraphics.destroy();
    this.markerGraphics.destroy();
    this.axisRenderer.destroy();
    this.staticContainer.destroy();

    if (this.staticTexture) {
      this.staticTexture.destroy(true);
      this.staticTexture = null;
    }

    if (this.staticSprite) {
      this.staticSprite.destroy();
      this.staticSprite = null;
    }

    // Destroy dynamic content
    this.curtainGraphics.destroy();
    this.lensGraphics.destroy();
    this.cursorLineGraphics.destroy();
    this.dynamicContainer.destroy();

    // Destroy main container
    this.container.destroy();
  }
}
