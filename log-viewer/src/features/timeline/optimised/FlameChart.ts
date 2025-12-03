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
  EventNode,
  TimelineMarker,
  TimelineOptions,
  TimelineState,
  TreeNode,
  ViewportState,
} from '../types/flamechart.types.js';
import { TIMELINE_CONSTANTS, TimelineError, TimelineErrorCode } from '../types/flamechart.types.js';
import type { SearchCursor, SearchMatch, SearchOptions } from '../types/search.types.js';
import { logEventToTreeNode } from '../utils/tree-converter.js';
import { AxisRenderer } from './AxisRenderer.js';
import { EventBatchRenderer } from './EventBatchRenderer.js';
import type { PrecomputedRect } from './RectangleManager.js';
import { RectangleManager } from './RectangleManager.js';
import { SearchHighlightRenderer } from './SearchHighlightRenderer.js';
import { SearchManager } from './SearchManager.js';
import { SearchStyleRenderer } from './SearchStyleRenderer.js';
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
  onSearchNavigate?: (event: EventNode, screenX: number, screenY: number, depth: number) => void;
}

/**
 * FlameChartCursor - Cursor with automatic side effects
 *
 * Wraps SearchCursor to add automatic centering, rendering, and callback
 * invocation when navigating between matches.
 */
class FlameChartCursor<E extends EventNode> implements SearchCursor<E> {
  constructor(
    private innerCursor: SearchCursor<E>,
    private onNavigate: (match: SearchMatch<E>) => void,
  ) {}

  get matches(): ReadonlyArray<SearchMatch<E>> {
    return this.innerCursor.matches;
  }

  get currentIndex(): number {
    return this.innerCursor.currentIndex;
  }

  get total(): number {
    return this.innerCursor.total;
  }

  next(): SearchMatch<E> | null {
    const match = this.innerCursor.next();
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  prev(): SearchMatch<E> | null {
    const match = this.innerCursor.prev();
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  first(): SearchMatch<E> | null {
    const match = this.innerCursor.first();
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  last(): SearchMatch<E> | null {
    const match = this.innerCursor.last();
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  seek(index: number): SearchMatch<E> | null {
    const match = this.innerCursor.seek(index);
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  getCurrent(): SearchMatch<E> | null {
    return this.innerCursor.getCurrent();
  }

  hasNext(): boolean {
    return this.innerCursor.hasNext();
  }

  hasPrev(): boolean {
    return this.innerCursor.hasPrev();
  }

  getMatchedEventIds(): ReadonlySet<string> {
    return this.innerCursor.getMatchedEventIds();
  }
}

export class FlameChart<E extends EventNode = EventNode> {
  private app: PIXI.Application | null = null;
  private container: HTMLElement | null = null;
  private viewport: TimelineViewport | null = null;
  private index: TimelineEventIndex | null = null;
  private state: TimelineState | null = null;
  private options: TimelineOptions = {};
  private callbacks: FlameChartCallbacks = {};

  private rectangleManager: RectangleManager | null = null;
  private batchRenderer: EventBatchRenderer | null = null;
  private axisRenderer: AxisRenderer | null = null;
  private markerRenderer: TimelineMarkerRenderer | null = null;
  private resizeHandler: TimelineResizeHandler | null = null;

  // New generic search system
  private newSearchManager: SearchManager<E> | null = null;
  private treeNodes: TreeNode<E>[] | null = null;

  private searchStyleRenderer: SearchStyleRenderer | null = null;
  private searchRenderer: SearchHighlightRenderer | null = null;

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

    // Convert LogEvent to TreeNode structure for generic search
    this.treeNodes = logEventToTreeNode(events) as unknown as TreeNode<E>[];

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

    // Create RectangleManager (single source of truth for rectangle computation)
    if (this.state) {
      const categories = new Set(this.state.batches.keys());
      this.rectangleManager = new RectangleManager(events, categories);
    }

    // Create batch renderer (pure rendering, receives rectangles from RectangleManager)
    if (this.worldContainer && this.state) {
      this.batchRenderer = new EventBatchRenderer(this.worldContainer, this.state.batches);
    }

    // Create search style renderer (renders with desaturation for search mode)
    if (this.worldContainer && this.state) {
      this.searchStyleRenderer = new SearchStyleRenderer(this.worldContainer, this.state.batches);
    }

    // Setup interaction handler
    this.setupInteractionHandler();

    this.resizeHandler = new TimelineResizeHandler(container, this);
    this.resizeHandler.setupResizeObserver();

    // Initialize search if enabled via options
    if (options.enableSearch) {
      this.initializeSearch();
    }

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

    // Clean up search components
    if (this.searchRenderer) {
      this.searchRenderer.destroy();
      this.searchRenderer = null;
    }

    if (this.searchStyleRenderer) {
      this.searchStyleRenderer.destroy();
      this.searchStyleRenderer = null;
    }

    // Clean up renderers
    if (this.batchRenderer) {
      this.batchRenderer.destroy();
      this.batchRenderer = null;
    }

    this.rectangleManager = null;

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
   * Initialize the new generic search system.
   * Builds ID-based rectMap and creates SearchManager.
   */
  private initializeSearch(): void {
    if (!this.rectangleManager || !this.treeNodes || !this.worldContainer) {
      throw new Error('FlameChart must be initialized before enabling search');
    }

    // Build rectMap by ID from PrecomputedRect
    const rectMap = new Map<string, PrecomputedRect>();
    const logEventRectMap = this.rectangleManager.getRectMap();

    for (const [_event, rect] of logEventRectMap.entries()) {
      // Cast to PrecomputedRect to access the id field;
      rectMap.set(rect.id, rect);
    }

    // Initialize new SearchManager
    this.newSearchManager = new SearchManager(this.treeNodes, rectMap);

    // Initialize search renderer (for borders/overlays on current match)
    this.searchRenderer = new SearchHighlightRenderer(this.worldContainer);

    // Ensure zIndex layering is honored for highlight graphics
    this.worldContainer.sortableChildren = true;
  }

  /**
   * Search events using predicate function.
   * Returns FlameChartCursor that automatically handles centering, tooltips, and rendering.
   *
   * @param predicate - Function to test each event
   * @param options - Search options (caseSensitive, matchWholeWord)
   * @returns FlameChartCursor for navigating results, or null if search not enabled
   */
  public search(predicate: (event: E) => boolean, options?: SearchOptions): SearchCursor<E> | null {
    if (!this.newSearchManager) {
      return null;
    }

    const innerCursor = this.newSearchManager.search(predicate, options);

    // Wrap with FlameChartCursor to add automatic side effects
    return new FlameChartCursor(innerCursor, (match) => this.handleSearchNavigation(match));
  }

  /**
   * Get current search cursor.
   * @returns Current cursor or undefined if no active search
   */
  public getSearchCursor(): SearchCursor<E> | undefined {
    return this.newSearchManager?.getCursor();
  }

  /**
   * Clear current search and reset cursor.
   */
  public clearSearch(): void {
    this.newSearchManager?.clear();
    this.requestRender();
  }

  /**
   * Handle search navigation side effects:
   * - Center viewport on match
   * - Call onSearchNavigate callback for application-specific logic (e.g., tooltips)
   * - Request render
   */
  private handleSearchNavigation(match: SearchMatch<E>): void {
    if (!this.viewport) {
      return;
    }

    // Center viewport on the match
    this.viewport.centerOnEvent(match.event.timestamp, match.event.duration, match.depth);

    // Call application-specific callback (e.g., for showing tooltips)
    if (this.callbacks.onSearchNavigate) {
      const viewportState = this.viewport.getState();
      const screenX = match.event.timestamp * viewportState.zoom - viewportState.offsetX;
      const screenY = this.viewport.depthToScreenY(match.depth);
      this.callbacks.onSearchNavigate(match.event, screenX, screenY, match.depth);
    }

    // Request render to show updated highlight
    this.requestRender();
  }

  /**
   * Get viewport manager instance.
   */
  public getViewportManager(): TimelineViewport | null {
    return this.viewport;
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
    if (
      !this.rectangleManager ||
      !this.batchRenderer ||
      !this.state ||
      !this.viewport ||
      !this.app ||
      !this.worldContainer
    ) {
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

    const culledRects = this.rectangleManager.getCulledRectangles(viewportState);

    // Render events (with or without search styling)
    const cursor = this.newSearchManager?.getCursor();

    if (cursor && cursor.total > 0) {
      // Search mode: render with desaturation
      const matchedEventIds = cursor.getMatchedEventIds();
      this.searchStyleRenderer!.render(culledRects, matchedEventIds);

      // Render highlight border for current match
      this.searchRenderer!.render(cursor, viewportState);

      // Clear normal renderer when in search mode
      if (this.batchRenderer) {
        this.batchRenderer.clear();
      }
    } else {
      // Normal mode: render with original colors
      this.batchRenderer.render(culledRects);

      // Clear search overlays when not in search mode
      if (this.searchStyleRenderer) {
        this.searchStyleRenderer.clear();
      }
      if (this.searchRenderer) {
        this.searchRenderer.clear();
      }
    }

    this.app.render();
  }
}
