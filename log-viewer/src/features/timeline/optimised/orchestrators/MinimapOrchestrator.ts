/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapOrchestrator
 *
 * Orchestrates all minimap functionality for the FlameChart.
 * Owns minimap state, renderers, and interaction handling.
 *
 * Responsibilities:
 * - Minimap lifecycle (init, destroy, resize)
 * - Coordinate transforms between minimap and main timeline
 * - Cursor mirroring between minimap and main timeline
 * - Keyboard handling when mouse is in minimap area
 *
 * Communication pattern:
 * - Uses callbacks to notify FlameChart of changes
 * - Receives ViewportState as read-only input
 * - Never mutates viewport directly
 */

import * as PIXI from 'pixi.js';
import type { TimelineMarker, ViewportState } from '../../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import type { RectangleManager } from '../RectangleManager.js';
import type { CursorLineRenderer } from '../rendering/CursorLineRenderer.js';
import type { TimelineEventIndex } from '../TimelineEventIndex.js';
import type { TimelineViewport } from '../TimelineViewport.js';

import { MinimapDensityQuery } from '../minimap/MinimapDensityQuery.js';
import { MinimapInteractionHandler } from '../minimap/MinimapInteractionHandler.js';
import { MINIMAP_GAP, MinimapManager, calculateMinimapHeight } from '../minimap/MinimapManager.js';
import { MinimapRenderer } from '../minimap/MinimapRenderer.js';

// Re-export for convenience
export { MINIMAP_GAP, calculateMinimapHeight };

/**
 * Callbacks for minimap orchestrator events.
 * These allow FlameChart to respond to minimap interactions.
 */
export interface MinimapOrchestratorCallbacks {
  /**
   * Called when the minimap selection changes (user created/moved/resized selection).
   * FlameChart should update the main viewport to match.
   *
   * @param zoom - New zoom level for main viewport
   * @param offsetX - New X offset for main viewport
   */
  onViewportChange: (zoom: number, offsetX: number) => void;

  /**
   * Called when minimap zoom (wheel event) changes the view.
   * FlameChart should apply zoom with anchor point preservation.
   *
   * @param factor - Zoom factor (>1 = zoom in, <1 = zoom out)
   * @param anchorTimeNs - Time position to anchor the zoom
   */
  onZoom: (factor: number, anchorTimeNs: number) => void;

  /**
   * Called when depth (Y) should change.
   * FlameChart should update the main viewport's offsetY.
   *
   * @param deltaY - Pixel delta for Y offset (positive = down)
   */
  onDepthPan: (deltaY: number) => void;

  /**
   * Called when the cursor position changes.
   * FlameChart should store this for rendering cursor lines.
   *
   * @param timeNs - Cursor time in nanoseconds, or null to hide
   */
  onCursorMove: (timeNs: number | null) => void;

  /**
   * Called when minimap needs a re-render.
   */
  requestRender: () => void;

  /**
   * Called when reset zoom is requested (double-click or keyboard).
   */
  onResetZoom: () => void;
}

/**
 * Context for rendering the minimap.
 * Passed to render() to provide all necessary data.
 */
export interface MinimapRenderContext {
  /** Current viewport state from main timeline */
  viewportState: ViewportState;
  /** Viewport bounds (includes depthStart/depthEnd) */
  viewportBounds: {
    depthStart: number;
    depthEnd: number;
  };
  /** Timeline markers to display */
  markers: TimelineMarker[];
  /** Batch colors for density visualization */
  batchColors: Map<string, { color: number }>;
  /** Current cursor position in nanoseconds (null to hide) */
  cursorTimeNs: number | null;
}

/**
 * Keyboard handler callbacks for minimap-specific shortcuts.
 */
export interface MinimapKeyboardCallbacks {
  /** Pan viewport lens horizontally by time delta */
  onPanViewport: (deltaTimeNs: number) => void;
  /** Pan depth vertically by pixel delta */
  onPanDepth: (deltaY: number) => void;
  /** Zoom selection in or out */
  onZoom: (direction: 'in' | 'out') => void;
  /** Jump to timeline start */
  onJumpStart: () => void;
  /** Jump to timeline end */
  onJumpEnd: () => void;
  /** Reset zoom to fit entire timeline */
  onResetZoom: () => void;
}

export class MinimapOrchestrator {
  // ============================================================================
  // PIXI RESOURCES
  // ============================================================================
  private app: PIXI.Application | null = null;
  private container: PIXI.Container | null = null;
  private htmlContainer: HTMLElement | null = null;

  // ============================================================================
  // MINIMAP COMPONENTS
  // ============================================================================
  private manager: MinimapManager | null = null;
  private renderer: MinimapRenderer | null = null;
  private interactionHandler: MinimapInteractionHandler | null = null;
  private densityQuery: MinimapDensityQuery | null = null;

  // ============================================================================
  // STATE
  // ============================================================================
  private cursorTimeNs: number | null = null;
  private isMouseInMinimap = false;
  private mouseX = 0;
  private mouseY = 0;
  private callbacks: MinimapOrchestratorCallbacks;

  // References to external dependencies (not owned)
  private index: TimelineEventIndex | null = null;
  private viewport: TimelineViewport | null = null;

  constructor(callbacks: MinimapOrchestratorCallbacks) {
    this.callbacks = callbacks;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Initialize the minimap system.
   *
   * @param minimapDiv - HTML element to render minimap into
   * @param width - Canvas width
   * @param height - Full container height (minimap height calculated from this)
   * @param index - Timeline event index for duration/depth info
   * @param rectangleManager - For density query and segment tree
   * @param viewport - Main timeline viewport (for reading state only)
   */
  public async init(
    minimapDiv: HTMLElement,
    width: number,
    height: number,
    index: TimelineEventIndex,
    rectangleManager: RectangleManager,
    viewport: TimelineViewport,
  ): Promise<void> {
    this.index = index;
    this.viewport = viewport;
    this.htmlContainer = minimapDiv;

    const minimapHeight = calculateMinimapHeight(height);

    // Create PIXI Application for minimap
    this.app = new PIXI.Application();
    await this.app.init({
      width,
      height: minimapHeight,
      antialias: false,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      roundPixels: true,
      autoDensity: true,
      autoStart: false,
    });
    this.app.ticker.stop();
    this.app.stage.eventMode = 'none';
    minimapDiv.appendChild(this.app.canvas);

    // Initialize minimap manager (state and coordinate transforms)
    this.manager = new MinimapManager(index.totalDuration, index.maxDepth, width, height);

    // Initialize density query (leverages segment tree for O(B x log N) performance)
    this.densityQuery = new MinimapDensityQuery(
      rectangleManager.getRectsByCategory(),
      index.totalDuration,
      index.maxDepth,
      rectangleManager.getSegmentTree(),
    );

    // Create minimap container on stage
    this.container = new PIXI.Container();
    this.app.stage.addChild(this.container);

    // Initialize minimap renderer with HTML container for lens label
    this.renderer = new MinimapRenderer(this.container, minimapDiv);
    this.renderer.setRenderer(this.app.renderer as PIXI.Renderer);

    // Initialize interaction handler
    this.setupInteractionHandler();
  }

  /**
   * Clean up all minimap resources.
   */
  public destroy(): void {
    if (this.interactionHandler) {
      this.interactionHandler.destroy();
      this.interactionHandler = null;
    }

    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }

    this.manager = null;
    this.densityQuery = null;
    this.container = null;

    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }

    this.htmlContainer = null;
    this.index = null;
    this.viewport = null;
  }

  /**
   * Handle resize of the minimap container.
   *
   * @param newWidth - New canvas width
   * @param newHeight - New full container height
   */
  public resize(newWidth: number, newHeight: number): void {
    const minimapHeight = calculateMinimapHeight(newHeight);

    if (this.app) {
      this.app.renderer.resize(newWidth, minimapHeight);
    }

    if (this.manager) {
      this.manager.resize(newWidth, newHeight);
    }

    if (this.densityQuery) {
      this.densityQuery.invalidateCache();
    }

    if (this.renderer) {
      this.renderer.invalidateStatic();
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get the current cursor time position.
   */
  public getCursorTimeNs(): number | null {
    return this.cursorTimeNs;
  }

  /**
   * Set cursor position from main timeline hover.
   * This is called when the cursor moves on the main timeline.
   *
   * @param timeNs - Cursor time in nanoseconds, or null to clear
   */
  public setCursorFromMainTimeline(timeNs: number | null): void {
    this.cursorTimeNs = timeNs;
    this.callbacks.requestRender();
  }

  /**
   * Check if mouse is currently in the minimap area.
   * Used by KeyboardHandler to route keyboard events.
   */
  public isMouseInMinimapArea(): boolean {
    return this.isMouseInMinimap;
  }

  /**
   * Get the minimap height.
   */
  public getHeight(): number {
    return this.manager?.getHeight() ?? 0;
  }

  /**
   * Get the PIXI Application for external rendering control.
   */
  public getApp(): PIXI.Application | null {
    return this.app;
  }

  /**
   * Invalidate the density cache.
   * Call when timeline data changes.
   */
  public invalidateCache(): void {
    this.densityQuery?.invalidateCache();
    this.renderer?.invalidateStatic();
  }

  /**
   * Refresh colors from CSS variables (e.g., after theme change).
   */
  public refreshColors(): void {
    this.renderer?.refreshColors();
  }

  // ============================================================================
  // KEYBOARD HANDLERS
  // These are called by FlameChart's KeyboardHandler when mouse is in minimap
  // ============================================================================

  /**
   * Pan the viewport lens horizontally.
   *
   * @param deltaTimeNs - Time delta in nanoseconds (positive = right)
   */
  public handlePanViewport(deltaTimeNs: number): void {
    if (!this.manager) {
      return;
    }

    this.manager.moveSelection(deltaTimeNs);
    const selection = this.manager.getSelection();
    this.notifyViewportChange(selection.startTime, selection.endTime);
  }

  /**
   * Pan the depth (Y) viewport.
   *
   * @param deltaY - Pixel delta (positive = down, showing shallower frames)
   */
  public handlePanDepth(deltaY: number): void {
    this.callbacks.onDepthPan(deltaY);
  }

  /**
   * Zoom the minimap selection.
   *
   * @param direction - 'in' to narrow the lens, 'out' to widen it
   */
  public handleZoom(direction: 'in' | 'out'): void {
    // This is handled by FlameChart via ViewportAnimator
    // The orchestrator doesn't own the viewport, so we delegate
  }

  /**
   * Jump to timeline start.
   */
  public handleJumpStart(): void {
    if (!this.manager) {
      return;
    }

    const selection = this.manager.getSelection();
    const duration = selection.endTime - selection.startTime;

    this.manager.setSelection(0, duration);
    const newSelection = this.manager.getSelection();
    this.notifyViewportChange(newSelection.startTime, newSelection.endTime);
  }

  /**
   * Jump to timeline end.
   */
  public handleJumpEnd(): void {
    if (!this.manager || !this.index) {
      return;
    }

    const selection = this.manager.getSelection();
    const duration = selection.endTime - selection.startTime;
    const totalDuration = this.index.totalDuration;

    this.manager.setSelection(totalDuration - duration, totalDuration);
    const newSelection = this.manager.getSelection();
    this.notifyViewportChange(newSelection.startTime, newSelection.endTime);
  }

  /**
   * Reset zoom to fit entire timeline.
   */
  public handleResetZoom(): void {
    this.callbacks.onResetZoom();
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  /**
   * Render the minimap.
   *
   * @param context - Render context with all necessary data
   */
  public render(context: MinimapRenderContext): void {
    if (!this.app || !this.renderer || !this.manager || !this.densityQuery) {
      return;
    }

    // Sync lens position with main viewport (including Y bounds)
    this.manager.setSelectionFromViewport(
      context.viewportState,
      context.viewportBounds.depthStart,
      context.viewportBounds.depthEnd,
    );

    // Query density data (cached unless display width changed)
    const densityData = this.densityQuery.query(context.viewportState.displayWidth);

    // Determine if user is interacting (for lens label visibility)
    const isHoveringLens =
      this.isMouseInMinimap && this.manager.isPointInsideLens(this.mouseX, this.mouseY);
    const isInteracting = isHoveringLens || this.manager.isDragging();

    // Render minimap
    this.renderer.render(
      this.manager,
      densityData,
      context.markers,
      context.batchColors,
      context.cursorTimeNs,
      isInteracting,
    );

    // Render the PIXI app
    this.app.render();
  }

  /**
   * Render cursor line on the main timeline.
   * This is called by FlameChart after main timeline rendering.
   *
   * @param cursorRenderer - CursorLineRenderer from main timeline
   * @param viewportState - Current main viewport state
   */
  public renderCursorLine(cursorRenderer: CursorLineRenderer, viewportState: ViewportState): void {
    cursorRenderer.render(viewportState, this.cursorTimeNs);
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Setup interaction handler for mouse events on minimap canvas.
   */
  private setupInteractionHandler(): void {
    if (!this.app || !this.manager) {
      return;
    }

    const canvas = this.app.canvas as HTMLCanvasElement;

    this.interactionHandler = new MinimapInteractionHandler(canvas, this.manager, {
      onSelectionChange: (startTime: number, endTime: number) => {
        this.notifyViewportChange(startTime, endTime);
      },
      onZoom: (factor: number, anchorTimeNs: number) => {
        this.callbacks.onZoom(factor, anchorTimeNs);
      },
      onResetView: () => {
        this.callbacks.onResetZoom();
      },
      onCursorMove: (timeNs: number | null) => {
        this.cursorTimeNs = timeNs;
        this.callbacks.onCursorMove(timeNs);
        this.callbacks.requestRender();
      },
      onHorizontalPan: (deltaPixels: number) => {
        if (!this.viewport || !this.manager) {
          return;
        }
        // Convert pixels to time using main viewport zoom
        const viewportState = this.viewport.getState();
        const deltaTime = deltaPixels / viewportState.zoom;
        this.manager.moveSelection(deltaTime);
        const selection = this.manager.getSelection();
        this.notifyViewportChange(selection.startTime, selection.endTime);
      },
      onDepthPan: (deltaY: number) => {
        this.handleMinimapDepthPan(deltaY, true);
      },
      onDepthPositionStart: (minimapY: number) => {
        this.handleMinimapDepthPositionStart(minimapY);
      },
    });

    // Track mouse enter/leave/move for keyboard support and lens tooltip
    canvas.addEventListener('mouseenter', () => {
      this.isMouseInMinimap = true;
    });
    canvas.addEventListener('mouseleave', () => {
      this.isMouseInMinimap = false;
    });
    canvas.addEventListener('mousemove', (event) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = event.clientX - rect.left;
      this.mouseY = event.clientY - rect.top;
    });
  }

  /**
   * Notify FlameChart of viewport change from minimap selection.
   *
   * @param startTime - Selection start time in nanoseconds
   * @param endTime - Selection end time in nanoseconds
   */
  private notifyViewportChange(startTime: number, endTime: number): void {
    if (!this.viewport) {
      return;
    }

    const viewportState = this.viewport.getState();
    const duration = endTime - startTime;

    if (duration <= 0) {
      return;
    }

    // Calculate new zoom to fit selection
    const newZoom = viewportState.displayWidth / duration;
    const newOffsetX = startTime * newZoom;

    this.callbacks.onViewportChange(newZoom, newOffsetX);
  }

  /**
   * Handle minimap depth pan (Y drag during move/create operation).
   *
   * @param deltaY - Pixel delta from input
   * @param scaled - If true, scale deltaY so lens follows mouse 1:1
   */
  private handleMinimapDepthPan(deltaY: number, scaled: boolean): void {
    if (!this.manager || !this.index) {
      return;
    }

    let effectiveDelta = deltaY;

    if (scaled) {
      // Scale deltaY so lens follows mouse 1:1 on minimap
      const minimapChartHeight = this.manager.getChartHeight();
      const totalDepthHeight = (this.index.maxDepth + 1) * TIMELINE_CONSTANTS.EVENT_HEIGHT;
      const scale = minimapChartHeight > 0 ? totalDepthHeight / minimapChartHeight : 1;
      // Apply slight damping (0.9) for smoother feel
      effectiveDelta = deltaY * scale * 0.9;
    }

    this.callbacks.onDepthPan(effectiveDelta);
  }

  /**
   * Handle initial depth positioning when 'create' drag starts on minimap.
   *
   * @param minimapY - Y coordinate in minimap where drag started
   */
  private handleMinimapDepthPositionStart(minimapY: number): void {
    if (!this.viewport || !this.manager || !this.index) {
      return;
    }

    const chartHeight = this.manager.getChartHeight();
    const minimapHeight = this.manager.getHeight();
    const axisHeight = minimapHeight - chartHeight;
    const maxDepth = this.index.maxDepth;
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const viewportState = this.viewport.getState();

    // Edge snap threshold (pixels from edge to trigger snap)
    const SNAP_THRESHOLD = 8;

    // Calculate the visible depth range (how many depths fit in viewport)
    const visibleDepths = viewportState.displayHeight / eventHeight;

    // Clamp minimapY to chart area
    const chartTop = axisHeight;
    const chartBottom = minimapHeight;
    const clampedY = Math.max(chartTop, Math.min(chartBottom, minimapY));

    // Calculate depth at click position
    const yRatio = (clampedY - chartTop) / chartHeight;
    const clickDepth = maxDepth * (1 - yRatio);

    // Determine which edge of the lens should be at the click position
    const isTopHalf = yRatio < 0.5;

    let targetDepth: number;
    if (isTopHalf) {
      targetDepth = clickDepth - visibleDepths;
    } else {
      targetDepth = clickDepth;
    }

    // Apply edge snapping
    const distFromTop = clampedY - chartTop;
    const distFromBottom = chartBottom - clampedY;

    if (distFromTop < SNAP_THRESHOLD) {
      targetDepth = maxDepth - visibleDepths;
    } else if (distFromBottom < SNAP_THRESHOLD) {
      targetDepth = 0;
    }

    // Convert target depth to offsetY delta
    const newOffsetY = -Math.max(0, targetDepth) * eventHeight;
    const deltaY = newOffsetY - viewportState.offsetY;

    this.callbacks.onDepthPan(deltaY);
  }
}
