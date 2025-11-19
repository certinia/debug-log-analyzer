/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * FlameChart - Generic flamechart visualization component
 *
 * Generic rendering engine for hierarchical time-based data.
 * Works with any data via LogEvent interface (kept for simplicity).
 * Apex-specific logic is handled via callbacks.
 */

import * as PIXI from 'pixi.js';
import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type {
  TimelineMarker,
  TimelineOptions,
  TimelineState,
  ViewportState,
} from '../types/timeline.types.js';
import { TIMELINE_CONSTANTS, TimelineError, TimelineErrorCode } from '../types/timeline.types.js';
import { AxisRenderer } from './AxisRenderer.js';
import { EventBatchRenderer } from './EventBatchRenderer.js';
import { TimelineEventIndex } from './TimelineEventIndex.js';
import { TimelineInteractionHandler } from './TimelineInteractionHandler.js';
import { TimelineMarkerRenderer } from './TimelineMarkerRenderer.js';
import { TimelineResizeHandler } from './TimelineResizeHandler.js';
import { TimelineViewport } from './TimelineViewport.js';

export interface FlameChartCallbacks {
  onMouseMove?: (
    screenX: number,
    screenY: number,
    event: LogEvent | null,
    marker: TimelineMarker | null,
  ) => void;
  onClick?: (
    screenX: number,
    screenY: number,
    event: LogEvent | null,
    marker: TimelineMarker | null,
  ) => void;
  onViewportChange?: (viewport: ViewportState) => void;
}

export class FlameChart {
  private app: PIXI.Application | null = null;
  private container: HTMLElement | null = null;
  private viewport: TimelineViewport | null = null;
  private index: TimelineEventIndex | null = null;
  private state: TimelineState | null = null;
  private options: TimelineOptions = {};
  private callbacks: FlameChartCallbacks = {};

  private batchRenderer: EventBatchRenderer | null = null;
  private axisRenderer: AxisRenderer | null = null;
  private markerRenderer: TimelineMarkerRenderer | null = null;
  private resizeHandler: TimelineResizeHandler | null = null;

  private worldContainer: PIXI.Container | null = null;
  private axisContainer: PIXI.Container | null = null;
  private markerContainer: PIXI.Container | null = null;
  private uiContainer: PIXI.Container | null = null;
  private renderLoopId: number | null = null;
  private interactionHandler: TimelineInteractionHandler | null = null;

  private readonly markers: TimelineMarker[] = [];

  /**
   * Initialize the flamechart renderer.
   */
  public async init(
    container: HTMLElement,
    events: LogEvent[],
    markers: TimelineMarker[] = [],
    options: TimelineOptions = {},
    callbacks: FlameChartCallbacks = {},
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

    this.container = container;
    this.options = options;
    this.callbacks = callbacks;

    // Store truncation markers for rendering
    this.markers.push(...markers);

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
    if (this.markerContainer && this.markers.length > 0) {
      this.markerRenderer = new TimelineMarkerRenderer(
        this.markerContainer,
        this.viewport,
        this.markers,
      );
    }

    // Create axis renderer SECOND
    if (this.axisContainer && this.uiContainer) {
      this.axisRenderer = new AxisRenderer(this.axisContainer, {
        height: 30,
        lineColor: 0x808080,
        textColor: '#808080',
        fontSize: 11,
        minLabelSpacing: 120,
      });
      this.axisRenderer.setScreenSpaceContainer(this.uiContainer);
    }

    // Create batch renderer LAST
    if (this.worldContainer && this.state) {
      this.batchRenderer = new EventBatchRenderer(this.worldContainer, this.state.batches, events);
    }

    // Setup interaction handler
    this.setupInteractionHandler();

    this.resizeHandler = new TimelineResizeHandler(container, this);
    this.resizeHandler.setupResizeObserver();

    // Initial render
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
    if (this.markerRenderer) {
      this.markerRenderer.destroy();
      this.markerRenderer = null;
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
   */
  public requestRender(): void {
    if (!this.state) {
      return;
    }

    this.state.needsRender = true;

    if (this.renderLoopId === null) {
      this.renderLoopId = requestAnimationFrame(() => {
        if (this.state && this.state.needsRender) {
          this.render();
          this.state.needsRender = false;
        }
        this.renderLoopId = null;
      });
    }
  }

  /**
   * Handle window resize.
   */
  public resize(newWidth: number, newHeight: number): void {
    if (!this.app || !this.viewport || !this.container || !this.index) {
      return;
    }

    if (newWidth <= 0 || newHeight <= 0) {
      return;
    }

    const oldState = this.viewport.getState();
    const oldWidth = oldState.displayWidth;

    const visibleTimeStart = oldState.offsetX / oldState.zoom;
    const visibleTimeEnd = (oldState.offsetX + oldWidth) / oldState.zoom;
    const visibleTimeRange = visibleTimeEnd - visibleTimeStart;

    const visibleWorldYBottom = -oldState.offsetY;

    this.app.renderer.resize(newWidth, newHeight);

    const newZoom = newWidth / visibleTimeRange;
    const newOffsetX = visibleTimeStart * newZoom;
    const newOffsetY = -visibleWorldYBottom;

    this.viewport.setStateForResize(newWidth, newHeight, newZoom, newOffsetX, newOffsetY);

    this.requestRender();
  }

  // ============================================================================
  // PRIVATE SETUP METHODS
  // ============================================================================

  private async setupPixiApplication(width: number, height: number): Promise<void> {
    const ticker = PIXI.Ticker.shared;
    ticker.autoStart = false;
    ticker.stop();

    const sysTicker = PIXI.Ticker.system;
    sysTicker.autoStart = false;
    sysTicker.stop();

    this.app = new PIXI.Application();
    await this.app.init({
      width,
      height,
      antialias: false,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      roundPixels: true,
      autoDensity: true,
      autoStart: false,
    });

    this.app.ticker.stop();
    this.app.stage.eventMode = 'none';

    if (this.container && this.app.canvas) {
      this.container.appendChild(this.app.canvas);
    }
  }

  private setupCoordinateSystem(): void {
    if (!this.app) {
      return;
    }

    const stage = this.app.stage;

    this.markerContainer = new PIXI.Container();
    this.markerContainer.position.set(0, this.app.screen.height);
    this.markerContainer.scale.y = -1;
    stage.addChild(this.markerContainer);

    this.axisContainer = new PIXI.Container();
    this.axisContainer.position.set(0, this.app.screen.height);
    this.axisContainer.scale.y = -1;
    stage.addChild(this.axisContainer);

    this.worldContainer = new PIXI.Container();
    this.worldContainer.position.set(0, this.app.screen.height);
    this.worldContainer.scale.set(1, -1);
    stage.addChild(this.worldContainer);

    this.uiContainer = new PIXI.Container();
    this.uiContainer.position.set(0, 0);
    this.uiContainer.scale.set(1, 1);
    stage.addChild(this.uiContainer);
  }

  private setupInteractionHandler(): void {
    if (!this.app || !this.viewport || !this.app.canvas) {
      return;
    }

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
          this.requestRender();
          if (this.callbacks.onViewportChange && this.viewport) {
            this.callbacks.onViewportChange(this.viewport.getState());
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

  private handleMouseMove(screenX: number, screenY: number): void {
    if (!this.viewport || !this.index) {
      return;
    }

    // Check for truncation markers
    const marker = this.markerRenderer?.hitTest(screenX, screenY) ?? null;

    // Find event at position
    const viewportState = this.viewport.getState();
    const depth = this.viewport.screenYToDepth(screenY);
    const event = this.index.findEventAtPosition(screenX, screenY, viewportState, depth, false);

    // Update cursor
    if (this.interactionHandler) {
      this.interactionHandler.updateCursor(event !== null || marker !== null);
    }

    // Notify callback
    if (this.callbacks.onMouseMove) {
      this.callbacks.onMouseMove(screenX, screenY, event, marker);
    }
  }

  private handleClick(screenX: number, screenY: number): void {
    if (!this.viewport || !this.index) {
      return;
    }

    // Check for truncation markers
    const truncationMarker = this.markerRenderer?.hitTest(screenX, screenY) ?? null;

    // Find event at position
    const viewportState = this.viewport.getState();
    const depth = this.viewport.screenYToDepth(screenY);
    const event = this.index.findEventAtPosition(screenX, screenY, viewportState, depth, false);

    // Notify callback
    if (this.callbacks.onClick) {
      this.callbacks.onClick(screenX, screenY, event, truncationMarker);
    }
  }

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

  private cssColorToPixi(cssColor: string): number {
    if (cssColor.startsWith('#')) {
      return parseInt(cssColor.slice(1), 16);
    }

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
  // ============================================================================

  private render(): void {
    if (!this.batchRenderer || !this.state || !this.viewport || !this.app || !this.worldContainer) {
      return;
    }

    const viewportState = this.viewport.getState();
    const { offsetX } = viewportState;

    this.state.viewport = viewportState;

    const screenHeight = this.app.screen.height;

    if (this.markerContainer) {
      this.markerContainer.position.set(-offsetX, screenHeight);
    }

    if (this.axisContainer) {
      this.axisContainer.position.set(-offsetX, screenHeight);
    }

    this.worldContainer.position.set(-offsetX, screenHeight - viewportState.offsetY);

    if (this.markerRenderer) {
      this.markerRenderer.render();
    }

    if (this.axisRenderer) {
      this.axisRenderer.render(viewportState);
    }

    this.batchRenderer.render(viewportState);

    this.app.render();
  }
}
