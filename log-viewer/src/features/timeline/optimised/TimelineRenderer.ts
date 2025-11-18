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
import { Ticker } from 'pixi.js';
import type { ApexLog, LogEvent } from '../../../core/log-parser/LogEvents.js';
import { goToRow } from '../../call-tree/components/CalltreeView.js';
import type {
  TimelineOptions,
  TimelineState,
  TruncationMarker,
  ViewportState,
} from '../types/timeline.types.js';
import { TIMELINE_CONSTANTS, TimelineError, TimelineErrorCode } from '../types/timeline.types.js';
import { AxisRenderer } from './AxisRenderer.js';
import { EventBatchRenderer } from './EventBatchRenderer.js';
import { TimelineEventIndex } from './TimelineEventIndex.js';
import { TimelineInteractionHandler } from './TimelineInteractionHandler.js';
import { TimelineResizeHandler } from './TimelineResizeHandler.js';
import { TimelineTooltipManager } from './TimelineTooltipManager.js';
import { TimelineViewport } from './TimelineViewport.js';
import { TruncationIndicatorRenderer } from './TruncationIndicatorRenderer.js';

export class TimelineRenderer {
  private app: PIXI.Application | null = null;
  private container: HTMLElement | null = null;
  private viewport: TimelineViewport | null = null;
  private index: TimelineEventIndex | null = null;
  private state: TimelineState | null = null;
  private options: TimelineOptions = {};

  private batchRenderer: EventBatchRenderer | null = null;
  private axisRenderer: AxisRenderer | null = null;
  private truncationRenderer: TruncationIndicatorRenderer | null = null;

  private resizeHandler: TimelineResizeHandler | null = null;

  private worldContainer: PIXI.Container | null = null; // Container for world-space content (affected by pan/zoom)
  private axisContainer: PIXI.Container | null = null; // Container for axis lines (only affected by horizontal pan)
  private truncationContainer: PIXI.Container | null = null; // Container for truncation indicators (behind axis and events)
  private uiContainer: PIXI.Container | null = null; // Container for screen-space UI (not affected by pan/zoom)
  private renderLoopId: number | null = null;
  private interactionHandler: TimelineInteractionHandler | null = null;
  private tooltipManager: TimelineTooltipManager | null = null;
  private apexLog: ApexLog | null = null;
  private readonly truncationMarkers: TruncationMarker[] = []; // Truncation indicators for visualization

  /**
   * Initialize the timeline renderer.
   *
   * @param container - HTML element to render into
   * @param apexLog - Parsed Apex log with metadata
   * @param events - Array of log events to visualize
   * @param truncationMarkers - Array of truncation markers extracted from log
   * @param options - Optional configuration
   */
  public async init(
    container: HTMLElement,
    apexLog: ApexLog,
    events: LogEvent[],
    truncationMarkers: TruncationMarker[] = [],
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

    // Check WebGL availability
    if (!PIXI.isWebGLSupported()) {
      throw new TimelineError(
        TimelineErrorCode.WEBGL_UNAVAILABLE,
        'WebGL is required but not available in this browser',
      );
    }

    this.apexLog = apexLog;
    this.container = container;
    this.options = options;

    // Store truncation markers for rendering
    (this.truncationMarkers as TruncationMarker[]).push(...truncationMarkers);

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

    // Create truncation renderer FIRST (renders behind axis and events)
    // Only render if we have truncation markers
    if (this.truncationContainer && this.truncationMarkers.length > 0) {
      this.truncationRenderer = new TruncationIndicatorRenderer(
        this.truncationContainer,
        this.viewport,
        this.truncationMarkers,
      );
    }

    // Create axis renderer SECOND (so it renders behind event rectangles but on top of truncation)
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

    // Create batch renderer LAST (so rectangles render on top of everything)
    // Pass events to constructor for pre-computation optimization
    if (this.worldContainer && this.state) {
      this.batchRenderer = new EventBatchRenderer(this.worldContainer, this.state.batches, events);
    }

    // Setup interaction handler
    this.setupInteractionHandler();

    // Setup tooltip manager
    this.setupTooltipManager();

    this.resizeHandler = new TimelineResizeHandler(container, this);
    this.resizeHandler.setupResizeObserver();

    // Measure initial render time
    this.requestRender();
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

    // Clean up truncation renderer
    if (this.truncationRenderer) {
      this.truncationRenderer.destroy();
      this.truncationRenderer = null;
    }

    if (this.resizeHandler) {
      this.resizeHandler.destroy();
      this.resizeHandler = null;
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
   *
   * Uses on-demand rendering: only schedules requestAnimationFrame when needed.
   * Prevents duplicate frame requests using renderLoopId guard.
   */
  public requestRender(): void {
    if (!this.state) {
      return;
    }

    this.state.needsRender = true;

    // Only schedule a render if one isn't already pending
    if (this.renderLoopId === null) {
      this.renderLoopId = requestAnimationFrame(() => {
        if (this.state && this.state.needsRender) {
          this.render();
          this.state.needsRender = false;
        }
        this.renderLoopId = null; // Ready for next request
      });
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
    // Disable automatic tickers to prevent auto-rendering and event management
    const ticker = Ticker.shared;
    ticker.autoStart = false;
    ticker.stop();

    const sysTicker = Ticker.system;
    sysTicker.autoStart = false;
    sysTicker.stop();

    this.app = new PIXI.Application();
    await this.app.init({
      width,
      height,
      antialias: false, // Disabled for performance per PixiJS guide
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      roundPixels: true, // Prevent sub-pixel rendering artifacts
      autoDensity: true,
      autoStart: false,
    });

    // Explicitly stop the ticker to prevent any automatic rendering
    // autoStart: false prevents the app's ticker from starting, but we also
    // need to ensure the ticker is completely stopped for on-demand rendering
    this.app.ticker.stop();

    // Disable automatic expensive hit testing + event processing since we do manual hit detection
    this.app.stage.eventMode = 'none';

    // Append canvas to container
    if (this.container && this.app.canvas) {
      this.container.appendChild(this.app.canvas);
    }
  }

  /**
   * Setup coordinate system: (0, 0) at bottom-left, Y-axis pointing up.
   *
   * Creates four containers (in z-order from back to front):
   * - truncationContainer: Truncation indicators (only horizontal pan, behind axis)
   * - axisContainer: Only affected by horizontal pan (for axis lines)
   * - worldContainer: Affected by both horizontal and vertical pan/zoom (for events)
   * - uiContainer: Screen-space UI (for axis labels, not affected by transforms)
   */
  private setupCoordinateSystem(): void {
    if (!this.app) {
      return;
    }

    const stage = this.app.stage;

    // Create truncation container FIRST (renders behind everything)
    // Only affected by horizontal pan (like axis), not vertical
    this.truncationContainer = new PIXI.Container();
    // Move origin to bottom-left
    this.truncationContainer.position.set(0, this.app.screen.height);
    // Invert Y-axis (flip upside down)
    this.truncationContainer.scale.y = -1;
    stage.addChild(this.truncationContainer);

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
    // Invert Y-axis (flip upside down), X-scale will be set per frame for zoom
    this.worldContainer.scale.set(1, -1);
    stage.addChild(this.worldContainer);

    // Create screen-space UI container (not affected by pan/zoom)
    // This stays at top-left with normal Y-axis (pointing down)
    this.uiContainer = new PIXI.Container();
    this.uiContainer.position.set(0, 0);
    this.uiContainer.scale.set(1, 1);
    stage.addChild(this.uiContainer);
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
        onClick: (x: number, y: number) => {
          this.handleClick(x, y);
        },
      },
    );
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
  }

  /**
   * Handle mouse move - show tooltip for event or truncation marker at position.
   *
   * Priority order:
   * 1. Check for truncation markers first (background layer)
   * 2. Check for events (foreground layer)
   * 3. Hide tooltip if nothing is hit
   */
  private handleMouseMove(screenX: number, screenY: number): void {
    if (!this.viewport || !this.index || !this.tooltipManager) {
      return;
    }

    // T015: Check for truncation markers first
    let truncationMarker = null;
    if (this.truncationRenderer) {
      truncationMarker = this.truncationRenderer.hitTest(screenX, screenY);
    }

    // Get viewport state
    const viewportState = this.viewport.getState();

    // Convert screen Y to depth level
    const depth = this.viewport.screenYToDepth(screenY);

    // Find event at position using binary search
    const event = this.index.findEventAtPosition(screenX, screenY, viewportState, depth, false);

    // Priority: Events take precedence over truncation markers
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
    } else if (truncationMarker) {
      // T016: Show tooltip for truncation marker (implemented in next task)
      this.tooltipManager.showTruncation(truncationMarker, screenX, screenY);

      // Update cursor to help/question when over truncation marker
      if (this.interactionHandler) {
        this.interactionHandler.updateCursor(true); // Keep grab cursor for now
      }
    } else {
      // Hide tooltip when not over anything
      this.tooltipManager.hide();

      // Update cursor to grab when not over anything
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
   * Handle click on timeline - navigate to clicked event or truncation marker.
   *
   * Priority order:
   * 1. Check for events (foreground layer) - checked via index.findEventAtPosition()
   * 2. Check for truncation markers (background layer) - checked via truncationRenderer.hitTest()
   * 3. No action if empty space clicked
   *
   * @param screenX - Mouse X coordinate relative to canvas
   * @param screenY - Mouse Y coordinate relative to canvas
   */
  private handleClick(screenX: number, screenY: number): void {
    if (!this.viewport || !this.index) {
      return;
    }

    // Check for truncation markers (background layer)
    const truncationMarker = this.truncationRenderer?.hitTest(screenX, screenY);
    if (truncationMarker) {
      goToRow(truncationMarker.startTime);
      return;
    }

    // Find event at position using binary search (foreground layer)
    const viewportState = this.viewport.getState();
    const depth = this.viewport.screenYToDepth(screenY);
    const event = this.index.findEventAtPosition(screenX, screenY, viewportState, depth, false);
    if (event) {
      goToRow(event.timestamp);
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

    return 0x000000;
  }

  // ============================================================================
  // RENDER LOOP
  // ============================================================================2

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
    const { offsetX } = viewportState;

    // Update state viewport (sync)
    this.state.viewport = viewportState;

    const screenHeight = this.app.screen.height;
    // Update truncation container position (only horizontal offset, no vertical - like axis)
    if (this.truncationContainer) {
      this.truncationContainer.position.set(-offsetX, screenHeight);
    }

    // Update axis container position (only horizontal offset, no vertical)
    if (this.axisContainer) {
      this.axisContainer.position.set(-offsetX, screenHeight);
    }

    // Update world container position to reflect viewport offset (pan)
    // World X moves opposite to offsetX (scrolling right = moving world left)
    // World Y: Subtract offsetY because increasing offsetY should move content up on screen
    // With inverted Y-axis, reducing container.y moves the bottom-left origin down, pushing content up
    this.worldContainer.position.set(-offsetX, screenHeight - viewportState.offsetY);

    // Render truncation indicators FIRST (behind axis and events)
    if (this.truncationRenderer) {
      this.truncationRenderer.render();
    }

    // Render time axis SECOND (on top of truncation, behind rectangles)
    // Labels are rendered in screen space (uiContainer), so they stay stable
    if (this.axisRenderer) {
      this.axisRenderer.render(viewportState);
    }

    // Render visible events using batch renderer LAST (on top of everything)
    // EventBatchRenderer handles:
    // - View frustum culling
    // - Category-based batching
    // - GPU-accelerated drawing
    this.batchRenderer.render(viewportState);

    // IMPORTANT: Explicitly render the PixiJS stage to the canvas
    // Required because autoStart: false disables automatic rendering
    // This is what actually displays the scene on screen
    this.app.render();
  }
}
