/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * TimelineRenderer
 *
 * Core rendering engine for PixiJS-based timeline visualization.
 * Manages PixiJS Application, coordinate system, and render loop.
 */

import * as PIXI from 'pixi.js';
import type { ApexLog, LogEvent } from '../../../core/log-parser/LogEvents.js';
import { AxisRenderer } from '../graphics/AxisRenderer.js';
import { EventBatchRenderer } from '../graphics/EventBatchRenderer.js';
import type { TimelineOptions, TimelineState, ViewportState } from '../types/timeline.types.js';
import { TIMELINE_CONSTANTS, TimelineError, TimelineErrorCode } from '../types/timeline.types.js';
import { TimelineEventIndex } from './TimelineEventIndex.js';
import { TimelineInteractionHandler } from './TimelineInteractionHandler.js';
import { TimelineTooltipManager } from './TimelineTooltipManager.js';
import { TimelineViewport } from './TimelineViewport.js';

export class TimelineRenderer {
  private app: PIXI.Application | null = null;
  private container: HTMLElement | null = null;
  private viewport: TimelineViewport | null = null;
  private index: TimelineEventIndex | null = null;
  private state: TimelineState | null = null;
  private options: TimelineOptions = {};
  private batchRenderer: EventBatchRenderer | null = null;
  private axisRenderer: AxisRenderer | null = null;
  private worldContainer: PIXI.Container | null = null; // Container for world-space content (affected by pan/zoom)
  private axisContainer: PIXI.Container | null = null; // Container for axis lines (only affected by horizontal pan)
  private uiContainer: PIXI.Container | null = null; // Container for screen-space UI (not affected by pan/zoom)
  private renderLoopId: number | null = null;
  private interactionHandler: TimelineInteractionHandler | null = null;
  private tooltipManager: TimelineTooltipManager | null = null;
  private apexLog: ApexLog | null = null;

  /**
   * Initialize the timeline renderer.
   *
   * @param container - HTML element to render into
   * @param events - Array of log events to visualize
   * @param options - Optional configuration
   */
  public async init(
    container: HTMLElement,
    apexLog: ApexLog,
    events: LogEvent[],
    options: TimelineOptions = {},
  ): Promise<void> {
    // Validate inputs
    if (!container || !(container instanceof HTMLElement)) {
      throw new TimelineError(
        TimelineErrorCode.INVALID_CONTAINER,
        'Container must be a valid HTML element',
      );
    }

    if (!events || !Array.isArray(events)) {
      throw new TimelineError(TimelineErrorCode.INVALID_EVENT_DATA, 'Events must be an array');
    }

    // T107: Allow empty events array - will show time axis only (clarification from 2025-11-07)

    // Check WebGL availability
    if (!this.isWebGLAvailable()) {
      throw new TimelineError(
        TimelineErrorCode.WEBGL_UNAVAILABLE,
        'WebGL is required but not available in this browser',
      );
    }

    this.apexLog = apexLog;
    this.container = container;
    this.options = options;

    // Get container dimensions
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) {
      throw new TimelineError(
        TimelineErrorCode.INVALID_CONTAINER,
        'Container must have non-zero dimensions',
      );
    }

    // Create event index
    this.index = new TimelineEventIndex(events);

    // Create viewport manager
    this.viewport = new TimelineViewport(
      width,
      height,
      this.index.totalDuration,
      this.index.maxDepth,
    );

    // Initialize PixiJS Application
    await this.setupPixiApplication(width, height);

    // Setup coordinate system (Y-axis inversion)
    this.setupCoordinateSystem();

    // Initialize state
    this.initializeState(events);

    // Create axis renderer FIRST (so it renders behind event rectangles)
    // Axis lines go in axis container (only horizontal pan), labels go in UI container
    if (this.axisContainer && this.uiContainer) {
      this.axisRenderer = new AxisRenderer(this.axisContainer, {
        height: 30,
        lineColor: 0x808080, // Medium gray for light/dark theme compatibility
        textColor: '#808080', // Medium gray for light/dark theme compatibility
        fontSize: 11,
        minLabelSpacing: 120, // Increased from 80 to require more zoom for fine granularity
      });
      // Set up screen-space container for labels
      this.axisRenderer.setScreenSpaceContainer(this.uiContainer);
    }

    // Create batch renderer AFTER axis (so rectangles render on top)
    if (this.worldContainer && this.state) {
      this.batchRenderer = new EventBatchRenderer(this.worldContainer, this.state.batches);
    }

    // Setup interaction handler
    this.setupInteractionHandler();

    // Setup tooltip manager
    this.setupTooltipManager();

    // Start render loop
    this.startRenderLoop();

    // Measure initial render time
    const startTime = performance.now();
    this.performInitialRender();
    const renderTime = performance.now() - startTime;

    // Log performance metrics (disabled in production via build config)
    // eslint-disable-next-line no-console
    console.log(
      `Timeline initialized: ${events.length} root events, ${this.index.eventCount} total events, max depth: ${this.index.maxDepth}`,
    );
    // eslint-disable-next-line no-console
    console.log(`Initial render completed in ${renderTime.toFixed(2)}ms (target: <2000ms)`);
  }

  /**
   * Clean up resources and remove event listeners.
   */
  public destroy(): void {
    // Stop render loop
    if (this.renderLoopId !== null) {
      cancelAnimationFrame(this.renderLoopId);
      this.renderLoopId = null;
    }

    // Clean up tooltip manager
    if (this.tooltipManager) {
      this.tooltipManager.destroy();
      this.tooltipManager = null;
    }

    // Clean up interaction handler
    if (this.interactionHandler) {
      this.interactionHandler.destroy();
      this.interactionHandler = null;
    }

    // Clean up batch renderer
    if (this.batchRenderer) {
      this.batchRenderer.destroy();
      this.batchRenderer = null;
    }

    // Clean up axis renderer
    if (this.axisRenderer) {
      this.axisRenderer.destroy();
      this.axisRenderer = null;
    }

    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }

    this.container = null;
    this.viewport = null;
    this.index = null;
    this.state = null;
  }

  /**
   * Get current viewport state.
   */
  public getViewport(): ViewportState | null {
    return this.viewport ? this.viewport.getState() : null;
  }

  /**
   * Request a redraw on next frame.
   */
  public requestRender(): void {
    if (this.state) {
      this.state.needsRender = true;
    }
  }

  /**
   * Handle window resize - preserve horizontal time range while scaling content.
   * Per T101: Maintain the same time span visible before/after resize.
   * Rectangles and axis elements scale proportionally to new dimensions.
   *
   * @param newWidth - New canvas width
   * @param newHeight - New canvas height
   */
  public resize(newWidth: number, newHeight: number): void {
    if (!this.app || !this.viewport || !this.container || !this.index) {
      return;
    }

    // Validate dimensions
    if (newWidth <= 0 || newHeight <= 0) {
      // eslint-disable-next-line no-console
      console.warn('Invalid resize dimensions:', newWidth, newHeight);
      return;
    }

    // Get current viewport state before resize
    const oldState = this.viewport.getState();
    const oldWidth = oldState.displayWidth;

    // Calculate the current visible time range (what we want to preserve)
    const visibleTimeStart = oldState.offsetX / oldState.zoom;
    const visibleTimeEnd = (oldState.offsetX + oldWidth) / oldState.zoom;
    const visibleTimeRange = visibleTimeEnd - visibleTimeStart;

    // Calculate the current visible vertical range (world Y coordinates)
    // With offsetY <= 0, worldYBottom = -offsetY
    const visibleWorldYBottom = -oldState.offsetY;

    // Resize PixiJS renderer
    this.app.renderer.resize(newWidth, newHeight);

    // Calculate new zoom to preserve the same time range
    // zoom = pixels / time, so for same time range: zoom = newWidth / timeRange
    const newZoom = newWidth / visibleTimeRange;

    // Calculate new offsetX to maintain the same start time
    const newOffsetX = visibleTimeStart * newZoom;

    // For vertical: Keep the same worldY at the bottom of the viewport
    // This prevents jumps by maintaining the same vertical reference point
    // newOffsetY = -visibleWorldYBottom maintains the same bottom reference
    const newOffsetY = -visibleWorldYBottom;

    // Update viewport state to preserve the time range
    // This updates dimensions, zoom, and offsets all at once without clamping zoom
    this.viewport.setStateForResize(newWidth, newHeight, newZoom, newOffsetX, newOffsetY);

    // Request re-render on next frame to prevent flickering
    // The render loop will handle it smoothly
    this.requestRender();
  }

  // ============================================================================
  // PRIVATE SETUP METHODS
  // ============================================================================

  /**
   * Setup PixiJS Application with WebGL renderer.
   */
  private async setupPixiApplication(width: number, height: number): Promise<void> {
    try {
      this.app = new PIXI.Application();

      await this.app.init({
        width,
        height,
        antialias: false, // Disabled for performance per PixiJS guide
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      // Append canvas to container
      if (this.container && this.app.canvas) {
        this.container.appendChild(this.app.canvas);
      }

      // eslint-disable-next-line no-console
      console.log('PixiJS Application initialized with WebGL renderer');
    } catch (error) {
      throw new TimelineError(
        TimelineErrorCode.RENDER_FAILED,
        'Failed to initialize PixiJS Application',
        error,
      );
    }
  }

  /**
   * Setup coordinate system: (0, 0) at bottom-left, Y-axis pointing up.
   *
   * Creates three containers:
   * - worldContainer: Affected by both horizontal and vertical pan/zoom (for events)
   * - axisContainer: Only affected by horizontal pan (for axis lines)
   * - uiContainer: Screen-space UI (for axis labels, not affected by transforms)
   */
  private setupCoordinateSystem(): void {
    if (!this.app) {
      return;
    }

    const stage = this.app.stage;

    // Create axis container (only affected by horizontal pan, not vertical)
    // This ensures axis lines stay fixed vertically when panning vertically
    this.axisContainer = new PIXI.Container();
    // Move origin to bottom-left
    this.axisContainer.position.set(0, this.app.screen.height);
    // Invert Y-axis (flip upside down)
    this.axisContainer.scale.y = -1;
    stage.addChild(this.axisContainer);

    // Create world-space container (will be transformed for pan/zoom)
    this.worldContainer = new PIXI.Container();
    // Move origin to bottom-left
    this.worldContainer.position.set(0, this.app.screen.height);
    // Invert Y-axis (flip upside down)
    this.worldContainer.scale.y = -1;
    stage.addChild(this.worldContainer);

    // Create screen-space UI container (not affected by pan/zoom)
    // This stays at top-left with normal Y-axis (pointing down)
    this.uiContainer = new PIXI.Container();
    this.uiContainer.position.set(0, 0);
    this.uiContainer.scale.set(1, 1);
    stage.addChild(this.uiContainer);

    // eslint-disable-next-line no-console
    console.log(
      'Coordinate system: axisContainer (horizontal pan only), worldContainer (full pan/zoom), uiContainer (screen space)',
    );
  }

  /**
   * Setup interaction handler for zoom/pan controls.
   */
  private setupInteractionHandler(): void {
    if (!this.app || !this.viewport || !this.app.canvas) {
      return;
    }

    // Create interaction handler
    this.interactionHandler = new TimelineInteractionHandler(
      this.app.canvas as HTMLCanvasElement,
      this.viewport,
      {
        enableZoom: true,
        enablePan: true,
        zoomSensitivity: 1.0,
        invertZoom: false,
      },
      {
        onViewportChange: () => {
          // Trigger re-render when viewport changes (zoom or pan)
          this.requestRender();

          // Notify external callback if provided
          if (this.options.onViewportChange && this.viewport) {
            this.options.onViewportChange(this.viewport.getState());
          }
        },
        onMouseMove: (x: number, y: number) => {
          this.handleMouseMove(x, y);
        },
        onClick: (_x: number, _y: number) => {
          // TODO: Implement event selection in future phase
        },
      },
    );

    // eslint-disable-next-line no-console
    console.log('Interaction handler initialized (zoom/pan enabled)');
  }

  /**
   * Setup tooltip manager for event hover tooltips.
   */
  private setupTooltipManager(): void {
    if (!this.container) {
      return;
    }

    this.tooltipManager = new TimelineTooltipManager(this.container, {
      enableFlip: true,
      cursorOffset: 10,
      categoryColors: {
        ...TIMELINE_CONSTANTS.DEFAULT_COLORS,
        ...this.options.colors,
      },
      apexLog: this.apexLog,
    });

    // eslint-disable-next-line no-console
    console.log('Tooltip manager initialized');
  }

  /**
   * Handle mouse move - show tooltip for event at position.
   */
  private handleMouseMove(screenX: number, screenY: number): void {
    if (!this.viewport || !this.index || !this.tooltipManager) {
      return;
    }

    // Get viewport state
    const viewportState = this.viewport.getState();

    // Convert screen Y to depth level
    const depth = this.viewport.screenYToDepth(screenY);

    // Find event at position using binary search
    const event = this.index.findEventAtPosition(screenX, screenY, viewportState, depth, false);

    if (event) {
      // Show tooltip for this event
      this.tooltipManager.show(event, screenX, screenY);

      // Update cursor to pointer when over an event
      if (this.interactionHandler) {
        this.interactionHandler.updateCursor(true);
      }

      // Call external callback if provided
      if (this.options.onEventHover) {
        this.options.onEventHover(event);
      }
    } else {
      // Hide tooltip when not over an event
      this.tooltipManager.hide();

      // Update cursor to grab when not over an event
      if (this.interactionHandler) {
        this.interactionHandler.updateCursor(false);
      }

      // Call external callback with null
      if (this.options.onEventHover) {
        this.options.onEventHover(null);
      }
    }
  }

  /**
   * Initialize timeline state.
   */
  private initializeState(events: LogEvent[]): void {
    if (!this.viewport) {
      return;
    }

    const batches = new Map();

    // Merge custom colors with defaults
    const colors = {
      ...TIMELINE_CONSTANTS.DEFAULT_COLORS,
      ...this.options.colors,
    };

    // Initialize empty batches for each category
    const categories = Object.keys(colors) as (keyof typeof colors)[];

    for (const category of categories) {
      batches.set(category, {
        category,
        color: this.cssColorToPixi(colors[category] || '#000000'),
        rectangles: [],
        isDirty: true,
      });
    }

    this.state = {
      events,
      viewport: this.viewport.getState(),
      batches,
      interaction: {
        isDragging: false,
        lastMousePos: { x: 0, y: 0 },
        hoveredEvent: null,
      },
      needsRender: true,
      isInitialized: true,
    };
  }

  /**
   * Check if WebGL is available.
   */
  private isWebGLAvailable(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return !!(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      );
    } catch {
      return false;
    }
  }

  /**
   * Convert CSS color string to PixiJS hex number.
   *
   * Handles formats: "#RRGGBB", "rgb(r, g, b)", "rgba(r, g, b, a)"
   */
  private cssColorToPixi(cssColor: string): number {
    // Handle hex: "#88AE58" → 0x88AE58
    if (cssColor.startsWith('#')) {
      return parseInt(cssColor.slice(1), 16);
    }

    // Handle rgb/rgba: "rgb(136, 174, 88)" → 0x88AE58
    const rgbMatch = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1] ?? '0', 10);
      const g = parseInt(rgbMatch[2] ?? '0', 10);
      const b = parseInt(rgbMatch[3] ?? '0', 10);
      return (r << 16) | (g << 8) | b;
    }

    // Fallback to black
    // eslint-disable-next-line no-console
    console.warn(`Unrecognized color format: ${cssColor}, using black`);
    return 0x000000;
  }

  // ============================================================================
  // RENDER LOOP
  // ============================================================================

  /**
   * Start the render loop using requestAnimationFrame.
   *
   * Uses dirty flag optimization: only re-renders when needsRender is true.
   * This prevents unnecessary GPU work on static frames.
   */
  private startRenderLoop(): void {
    const renderFrame = (): void => {
      if (this.state && this.state.needsRender) {
        this.render();
        this.state.needsRender = false;
      }

      // Continue loop
      this.renderLoopId = requestAnimationFrame(renderFrame);
    };

    // Start loop
    this.renderLoopId = requestAnimationFrame(renderFrame);
  }

  /**
   * Perform initial render to display all events.
   *
   * Called once during initialization to measure render time.
   */
  private performInitialRender(): void {
    if (this.state) {
      this.state.needsRender = true;
      this.render();
      this.state.needsRender = false;
    }
  }

  /**
   * Core render method: renders visible events using EventBatchRenderer.
   *
   * Implements view frustum culling via EventBatchRenderer.
   * Only visible events within viewport bounds are rendered.
   */
  private render(): void {
    if (!this.batchRenderer || !this.state || !this.viewport || !this.app || !this.worldContainer) {
      return;
    }

    // Get current viewport state
    const viewportState = this.viewport.getState();

    // Update state viewport (sync)
    this.state.viewport = viewportState;

    // Update axis container position (only horizontal offset, no vertical)
    if (this.axisContainer) {
      this.axisContainer.position.set(-viewportState.offsetX, this.app.screen.height);
    }

    // Update world container position to reflect viewport offset (pan)
    // World X moves opposite to offsetX (scrolling right = moving world left)
    // World Y: Subtract offsetY because increasing offsetY should move content up on screen
    // With inverted Y-axis, reducing container.y moves the bottom-left origin down, pushing content up
    this.worldContainer.position.set(
      -viewportState.offsetX,
      this.app.screen.height - viewportState.offsetY,
    );

    // Render time axis FIRST (so lines appear behind rectangles)
    // Labels are rendered in screen space (uiContainer), so they stay stable
    if (this.axisRenderer) {
      this.axisRenderer.render(viewportState);
    }

    // Render visible events using batch renderer (on top of axis)
    // EventBatchRenderer handles:
    // - View frustum culling
    // - Category-based batching
    // - GPU-accelerated drawing
    this.batchRenderer.render(this.state.events, viewportState);
  }
}
