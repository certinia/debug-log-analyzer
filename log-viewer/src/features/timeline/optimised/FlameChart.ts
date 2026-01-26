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
  ModifierKeys,
  TimelineMarker,
  TimelineOptions,
  TimelineState,
  TreeNode,
  ViewportState,
} from '../types/flamechart.types.js';
import { TIMELINE_CONSTANTS, TimelineError, TimelineErrorCode } from '../types/flamechart.types.js';
import type { SearchCursor, SearchMatch, SearchOptions } from '../types/search.types.js';
import type { NavigationMaps } from '../utils/tree-converter.js';

import { MeshMarkerRenderer } from './markers/MeshMarkerRenderer.js';
import { MeshRectangleRenderer } from './MeshRectangleRenderer.js';
import { MeshSearchStyleRenderer } from './search/MeshSearchStyleRenderer.js';
import { MeshAxisRenderer } from './time-axis/MeshAxisRenderer.js';

import { EventBatchRenderer } from './EventBatchRenderer.js';
import { TimelineMarkerRenderer } from './markers/TimelineMarkerRenderer.js';
import { SearchHighlightRenderer } from './search/SearchHighlightRenderer.js';
import { SearchStyleRenderer } from './search/SearchStyleRenderer.js';
import { SearchTextLabelRenderer } from './search/SearchTextLabelRenderer.js';
import { TextLabelRenderer } from './TextLabelRenderer.js';
import { AxisRenderer } from './time-axis/AxisRenderer.js';

import { cssColorToPixi } from './BucketColorResolver.js';
import { HitTestManager } from './interaction/HitTestManager.js';
import {
  KEYBOARD_CONSTANTS,
  KeyboardHandler,
  type FrameNavDirection,
  type MarkerNavDirection,
} from './interaction/KeyboardHandler.js';
import { TimelineInteractionHandler } from './interaction/TimelineInteractionHandler.js';
import { TimelineResizeHandler } from './interaction/TimelineResizeHandler.js';
import { AreaZoomRenderer } from './measurement/AreaZoomRenderer.js';
import { MeasurementManager, type MeasurementState } from './measurement/MeasurementManager.js';
import { MeasureRangeRenderer } from './measurement/MeasureRangeRenderer.js';
import type { PrecomputedRect } from './RectangleManager.js';
import { RectangleManager } from './RectangleManager.js';
import { CursorLineRenderer } from './rendering/CursorLineRenderer.js';
import { FlameChartCursor } from './search/FlameChartCursor.js';
import { SearchManager } from './search/SearchManager.js';
import { SelectionHighlightRenderer } from './selection/SelectionHighlightRenderer.js';
import { SelectionManager } from './selection/SelectionManager.js';
import { TimelineEventIndex } from './TimelineEventIndex.js';
import { TimelineViewport } from './TimelineViewport.js';
import { ViewportAnimator } from './ViewportAnimator.js';

// Minimap imports
import { MinimapDensityQuery } from './minimap/MinimapDensityQuery.js';
import { MinimapInteractionHandler } from './minimap/MinimapInteractionHandler.js';
import { MINIMAP_GAP, MinimapManager, calculateMinimapHeight } from './minimap/MinimapManager.js';
import { MinimapRenderer } from './minimap/MinimapRenderer.js';

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
    modifiers?: ModifierKeys,
  ) => void;
  onViewportChange?: (viewport: ViewportState) => void;
  onSearchNavigate?: (event: EventNode, screenX: number, screenY: number, depth: number) => void;
  /** Called when keyboard navigates to a frame (includes screen coords for tooltip). */
  onFrameNavigate?: (event: EventNode, screenX: number, screenY: number, depth: number) => void;
  /** Called when keyboard navigates to a marker (includes screen coords for tooltip). */
  onMarkerNavigate?: (marker: TimelineMarker, screenX: number, screenY: number) => void;
  /** Called when frame selection changes (click to select, arrow keys to navigate). */
  onSelect?: (event: EventNode | null) => void;
  /** Called when marker selection changes (click to select, arrow keys to navigate). */
  onMarkerSelect?: (marker: TimelineMarker | null) => void;
  /** Called when J key is pressed to jump to call tree for selected frame or marker. */
  onJumpToCallTree?: (event: EventNode) => void;
  /** Called when J key is pressed to jump to call tree for selected marker. */
  onJumpToCallTreeForMarker?: (marker: TimelineMarker) => void;
  /**
   * Called when right-click occurs on the timeline.
   * Passes screen coords for tooltip and client coords for menu positioning.
   * target is the clicked item: EventNode, TimelineMarker, or null for empty space.
   */
  onContextMenu?: (
    target: EventNode | TimelineMarker | null,
    screenX: number,
    screenY: number,
    clientX: number,
    clientY: number,
  ) => void;
  /** Called when Ctrl/Cmd+C is pressed to copy selected frame or marker. */
  onCopy?: (event: EventNode) => void;
  /** Called when Ctrl/Cmd+C is pressed to copy selected marker. */
  onCopyMarker?: (marker: TimelineMarker) => void;
  /** Called when measurement state changes (started, updated, finished, cleared). */
  onMeasurementChange?: (measurement: MeasurementState | null) => void;
}

export class FlameChart<E extends EventNode = EventNode> {
  private app: PIXI.Application | null = null; // Main timeline
  private minimapApp: PIXI.Application | null = null; // Minimap
  private container: HTMLElement | null = null;
  private wrapper: HTMLDivElement | null = null;
  private viewport: TimelineViewport | null = null;
  private index: TimelineEventIndex | null = null;
  private state: TimelineState | null = null;
  private options: TimelineOptions = {};
  private callbacks: FlameChartCallbacks = {};

  private rectangleManager: RectangleManager | null = null;
  private batchRenderer: EventBatchRenderer | MeshRectangleRenderer | null = null;
  private axisRenderer: AxisRenderer | MeshAxisRenderer | null = null;
  private markerRenderer: TimelineMarkerRenderer | MeshMarkerRenderer | null = null;
  private resizeHandler: TimelineResizeHandler | null = null;

  // New generic search system
  private newSearchManager: SearchManager<E> | null = null;
  private treeNodes: TreeNode<E>[] | null = null;

  private searchStyleRenderer: SearchStyleRenderer | MeshSearchStyleRenderer | null = null;
  private searchRenderer: SearchHighlightRenderer | null = null;
  private textLabelRenderer: TextLabelRenderer | null = null;
  private searchTextLabelRenderer: SearchTextLabelRenderer | null = null;

  private worldContainer: PIXI.Container | null = null;
  private axisContainer: PIXI.Container | null = null;
  private markerContainer: PIXI.Container | null = null;
  private uiContainer: PIXI.Container | null = null;
  private renderLoopId: number | null = null;
  private interactionHandler: TimelineInteractionHandler | null = null;
  private keyboardHandler: KeyboardHandler | null = null;

  private readonly markers: TimelineMarker[] = [];

  private hitTestManager: HitTestManager | null = null;

  // Selection system
  private selectionManager: SelectionManager<E> | null = null;
  private selectionRenderer: SelectionHighlightRenderer | null = null;
  private viewportAnimator: ViewportAnimator | null = null;

  // Measurement system (Shift+drag to measure time range)
  private measurementManager: MeasurementManager | null = null;
  private measurementRenderer: MeasureRangeRenderer | null = null;

  // Area zoom system (Alt+drag to zoom to area)
  private areaZoomManager: MeasurementManager | null = null;
  private areaZoomRenderer: AreaZoomRenderer | null = null;

  // Resize state (drag existing measurement edge)
  private resizeEdge: 'left' | 'right' | null = null;
  private resizeAnchorTime: number | null = null; // The fixed edge during resize

  // Minimap system (Chrome DevTools-style overview with viewport lens)
  private minimapManager: MinimapManager | null = null;
  private minimapRenderer: MinimapRenderer | null = null;
  private minimapInteractionHandler: MinimapInteractionHandler | null = null;
  private minimapContainer: PIXI.Container | null = null;
  private minimapDensityQuery: MinimapDensityQuery | null = null;
  private minimapDiv: HTMLElement | null = null; // HTML container for lens label

  // Cursor mirroring system (bidirectional cursor line between main and minimap)
  private cursorTimeNs: number | null = null; // Current cursor position in nanoseconds
  private cursorLineRenderer: CursorLineRenderer | null = null; // Renders cursor on main timeline

  // Minimap keyboard support - tracks if mouse is in minimap area
  private isMouseInMinimap = false;
  // Minimap mouse position for lens tooltip detection
  private minimapMouseX = 0;
  private minimapMouseY = 0;

  /**
   * Initialize the flamechart renderer.
   *
   * @param container - HTML element to render into
   * @param events - Array of LogEvent objects for rendering
   * @param treeNodes - Pre-converted TreeNode structure for navigation/search (from logEventToTreeNode)
   * @param maps - Pre-built navigation maps from tree conversion
   * @param markers - Timeline markers (truncation regions, etc.)
   * @param options - Rendering options
   * @param callbacks - Event callbacks
   */
  public async init(
    container: HTMLElement,
    events: LogEvent[],
    treeNodes: TreeNode<E>[],
    maps: NavigationMaps,
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

    // Calculate minimap height BEFORE creating viewport
    // Viewport needs the available height for main timeline (excluding minimap + gap)
    const minimapHeight = calculateMinimapHeight(height);
    const mainTimelineHeight = height - minimapHeight - MINIMAP_GAP;

    // Create viewport manager with adjusted height for main timeline area
    this.viewport = new TimelineViewport(
      width,
      mainTimelineHeight,
      this.index.totalDuration,
      this.index.maxDepth,
    );

    // Initialize PixiJS Application
    await this.setupPixiApplication(width, height);

    // Setup coordinate system (Y-axis inversion)
    this.setupCoordinateSystem();

    // Initialize state
    this.initializeState(events);

    // Store pre-converted TreeNode structure for search and navigation
    this.treeNodes = treeNodes;

    // Initialize selection manager for frame selection and traversal
    // Pass pre-built maps to avoid duplicate O(n) traversal
    this.selectionManager = new SelectionManager<E>(this.treeNodes, maps);

    // Set markers in selection manager for marker navigation
    this.selectionManager.setMarkers(this.markers);

    // Initialize viewport animator for smooth transitions
    this.viewportAnimator = new ViewportAnimator();

    // Determine renderer type: mesh is default for testing
    const useMeshRenderer = options.renderer !== 'sprite';

    // Create truncation renderer FIRST (renders behind axis and events)
    if (this.markerContainer && this.markers.length > 0) {
      if (useMeshRenderer) {
        this.markerRenderer = new MeshMarkerRenderer(
          this.markerContainer,
          this.viewport,
          this.markers,
        );
      } else {
        this.markerRenderer = new TimelineMarkerRenderer(
          this.markerContainer,
          this.viewport,
          this.markers,
        );
      }
    }

    // Create axis renderer SECOND
    if (this.axisContainer && this.uiContainer) {
      const axisConfig = {
        height: 30,
        lineColor: 0x808080,
        textColor: '#808080',
        fontSize: 11,
        minLabelSpacing: 120,
      };
      if (useMeshRenderer) {
        this.axisRenderer = new MeshAxisRenderer(this.axisContainer, axisConfig);
      } else {
        this.axisRenderer = new AxisRenderer(this.axisContainer, axisConfig);
      }
      this.axisRenderer.setScreenSpaceContainer(this.uiContainer);
      // No minimap offset needed - main timeline has its own canvas
    }

    // Create RectangleManager (single source of truth for rectangle computation)
    if (this.state) {
      const categories = new Set(this.state.batches.keys());
      this.rectangleManager = new RectangleManager(events, categories);
    }

    // Create batch renderer (pure rendering, receives rectangles from RectangleManager)
    if (this.worldContainer && this.state) {
      if (useMeshRenderer) {
        this.batchRenderer = new MeshRectangleRenderer(this.worldContainer, this.state.batches);
      } else {
        this.batchRenderer = new EventBatchRenderer(this.worldContainer, this.state.batches);
      }
    }

    // Create search style renderer (renders with desaturation for search mode)
    if (this.worldContainer && this.state) {
      if (useMeshRenderer) {
        this.searchStyleRenderer = new MeshSearchStyleRenderer(
          this.worldContainer,
          this.state.batches,
        );
      } else {
        this.searchStyleRenderer = new SearchStyleRenderer(this.worldContainer, this.state.batches);
      }
    }

    // Create text label renderer (renders method names on rectangles)
    if (this.worldContainer && this.state) {
      this.textLabelRenderer = new TextLabelRenderer(this.worldContainer);
      await this.textLabelRenderer.loadFont();
      this.textLabelRenderer.setBatches(this.state.batches);

      // SearchTextLabelRenderer uses composition - delegates matched labels to TextLabelRenderer
      this.searchTextLabelRenderer = new SearchTextLabelRenderer(
        this.worldContainer,
        this.textLabelRenderer,
        this.state.batches,
      );

      // Enable zIndex sorting for proper layering
      this.worldContainer.sortableChildren = true;
    }

    // For mesh renderers, set stage container for clip-space rendering
    if (useMeshRenderer && this.app) {
      const stage = this.app.stage;
      if (this.batchRenderer && 'setStageContainer' in this.batchRenderer) {
        (this.batchRenderer as MeshRectangleRenderer).setStageContainer(stage);
      }
      if (this.searchStyleRenderer && 'setStageContainer' in this.searchStyleRenderer) {
        (this.searchStyleRenderer as MeshSearchStyleRenderer).setStageContainer(stage);
      }
      if (this.markerRenderer && 'setStageContainer' in this.markerRenderer) {
        (this.markerRenderer as MeshMarkerRenderer).setStageContainer(stage);
      }
      if (this.axisRenderer && 'setStageContainer' in this.axisRenderer) {
        (this.axisRenderer as MeshAxisRenderer).setStageContainer(stage);
      }
      // No minimap offset needed - main timeline has its own canvas
    }

    // Create hit test manager for mouse interactions
    // Pass rectangleManager for O(log n) hit testing queries
    this.hitTestManager = new HitTestManager({
      index: this.index,
      visibleRects: new Map(),
      buckets: new Map(),
      markerRenderer: this.markerRenderer,
      rectangleManager: this.rectangleManager,
    });

    // Create selection highlight renderer
    if (this.worldContainer) {
      this.selectionRenderer = new SelectionHighlightRenderer(this.worldContainer);
      // Set marker context for marker selection highlighting
      this.selectionRenderer.setMarkerContext(this.markers, this.index.totalDuration);
    }

    // Initialize measurement system (Shift+drag to measure time range)
    this.measurementManager = new MeasurementManager();
    if (this.worldContainer && this.container) {
      this.measurementRenderer = new MeasureRangeRenderer(this.worldContainer, this.container, () =>
        this.zoomToMeasurement(),
      );
    }

    // Initialize area zoom system (Alt+drag to zoom to area)
    this.areaZoomManager = new MeasurementManager();
    if (this.worldContainer && this.container) {
      this.areaZoomRenderer = new AreaZoomRenderer(this.worldContainer, this.container);
    }

    // Initialize cursor line renderer (for bidirectional cursor mirroring)
    if (this.uiContainer) {
      this.cursorLineRenderer = new CursorLineRenderer(this.uiContainer);
    }

    // Initialize minimap system
    this.setupMinimap();

    // Setup interaction handler
    this.setupInteractionHandler();

    // Setup keyboard handler
    this.setupKeyboardHandler();

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

    // Clean up keyboard handler
    if (this.keyboardHandler) {
      this.keyboardHandler.destroy();
      this.keyboardHandler = null;
    }

    // Clean up selection components
    if (this.selectionRenderer) {
      this.selectionRenderer.destroy();
      this.selectionRenderer = null;
    }
    this.selectionManager = null;

    // Clean up measurement components
    if (this.measurementRenderer) {
      this.measurementRenderer.destroy();
      this.measurementRenderer = null;
    }
    this.measurementManager = null;

    // Clean up area zoom components
    if (this.areaZoomRenderer) {
      this.areaZoomRenderer.destroy();
      this.areaZoomRenderer = null;
    }
    this.areaZoomManager = null;

    // Clean up cursor line renderer
    if (this.cursorLineRenderer) {
      this.cursorLineRenderer.destroy();
      this.cursorLineRenderer = null;
    }

    // Clean up minimap components
    if (this.minimapInteractionHandler) {
      this.minimapInteractionHandler.destroy();
      this.minimapInteractionHandler = null;
    }
    if (this.minimapRenderer) {
      this.minimapRenderer.destroy();
      this.minimapRenderer = null;
    }
    this.minimapManager = null;
    this.minimapDensityQuery = null;
    this.minimapContainer = null;

    // Clean up viewport animator
    if (this.viewportAnimator) {
      this.viewportAnimator.cancel();
      this.viewportAnimator = null;
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

    // Clean up text label renderer
    if (this.searchTextLabelRenderer) {
      this.searchTextLabelRenderer.destroy();
      this.searchTextLabelRenderer = null;
    }

    if (this.textLabelRenderer) {
      this.textLabelRenderer.destroy();
      this.textLabelRenderer = null;
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

    this.hitTestManager = null;

    // Destroy minimap app first
    if (this.minimapApp) {
      this.minimapApp.destroy(true, { children: true, texture: true });
      this.minimapApp = null;
    }

    // Destroy main app
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
    }

    // Remove wrapper from container
    if (this.wrapper && this.container) {
      this.container.removeChild(this.wrapper);
      this.wrapper = null;
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

    // Clear selection when starting a new search to show search highlights
    this.selectionManager?.clear();
    if (this.selectionRenderer) {
      this.selectionRenderer.clear();
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
   * If a frame is selected, selection highlight will automatically show via getHighlightMode().
   */
  public clearSearch(): void {
    this.newSearchManager?.clear();
    this.requestRender();
  }

  /**
   * Handle search navigation side effects:
   * - Clear selection so search highlight shows via getHighlightMode()
   * - Center viewport on match
   * - Call onSearchNavigate callback for application-specific logic (e.g., tooltips)
   * - Request render
   */
  private handleSearchNavigation(match: SearchMatch<E>): void {
    if (!this.viewport) {
      return;
    }

    // Clear selection so search highlight shows
    this.selectionManager?.clear();
    if (this.selectionRenderer) {
      this.selectionRenderer.clear();
    }

    // Center viewport on the match
    this.viewport.centerOnEvent(match.event.timestamp, match.event.duration, match.depth);

    // Call application-specific callback (e.g., for showing tooltips)
    if (this.callbacks.onSearchNavigate) {
      const screenX = this.viewport.calculateVisibleCenterX(
        match.event.timestamp,
        match.event.duration,
      );
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

    // Calculate new minimap and main timeline heights
    const minimapHeight = calculateMinimapHeight(newHeight);
    const mainTimelineHeight = newHeight - minimapHeight - MINIMAP_GAP;

    // Resize minimap app
    if (this.minimapApp) {
      this.minimapApp.renderer.resize(newWidth, minimapHeight);
    }

    // Resize main timeline app
    this.app.renderer.resize(newWidth, mainTimelineHeight);

    // Update wrapper div heights
    if (this.wrapper) {
      const minimapDiv = this.wrapper.children[0] as HTMLElement;
      if (minimapDiv) {
        minimapDiv.style.height = `${minimapHeight}px`;
      }
    }

    const newZoom = newWidth / visibleTimeRange;
    const newOffsetX = visibleTimeStart * newZoom;
    const newOffsetY = -visibleWorldYBottom;

    // Update minimap manager for new dimensions
    if (this.minimapManager) {
      this.minimapManager.resize(newWidth, newHeight);
    }

    // Update viewport with main timeline dimensions only
    this.viewport.setStateForResize(newWidth, mainTimelineHeight, newZoom, newOffsetX, newOffsetY);

    // No minimap offset needed for axis or mesh renderers - separate canvases

    if (this.minimapDensityQuery) {
      this.minimapDensityQuery.invalidateCache();
    }
    if (this.minimapRenderer) {
      this.minimapRenderer.invalidateStatic();
    }

    this.requestRender();
  }

  /**
   * Update timeline colors and request a re-render.
   * Updates batch colors and re-renders the timeline.
   */
  public setColors(colors: Record<string, string>): void {
    if (!this.state) {
      return;
    }

    // Update batch colors (pre-blended opaque)
    for (const [category, batch] of this.state.batches) {
      const colorValue = colors[category];
      if (colorValue) {
        batch.color = cssColorToPixi(colorValue);
        batch.isDirty = true;
      }
    }

    // Rebuild batch colors cache (used by bucket color resolution)
    this.state.batchColorsCache = this.buildBatchColorsCache(this.state.batches);

    // Invalidate minimap static content to re-render with new colors
    this.minimapRenderer?.invalidateStatic();

    // Request re-render
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

    // Calculate minimap and main timeline heights
    const minimapHeight = calculateMinimapHeight(height);
    const mainTimelineHeight = height - minimapHeight - MINIMAP_GAP;

    // Create wrapper container with flexbox layout
    this.wrapper = document.createElement('div');
    this.wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';

    // Minimap container (fixed height)
    // Store reference for HTML label positioning
    this.minimapDiv = document.createElement('div');
    this.minimapDiv.style.cssText = `height:${minimapHeight}px;width:100%;flex-shrink:0;position:relative`;

    // Gap element
    const gapDiv = document.createElement('div');
    gapDiv.style.cssText = `height:${MINIMAP_GAP}px;width:100%;flex-shrink:0;background:transparent`;

    // Main timeline container (fills remaining space)
    const mainDiv = document.createElement('div');
    mainDiv.style.cssText = 'flex:1;width:100%;min-height:0';

    this.wrapper.append(this.minimapDiv, gapDiv, mainDiv);

    if (this.container) {
      this.container.appendChild(this.wrapper);
    }

    // Create minimap app
    this.minimapApp = new PIXI.Application();
    await this.minimapApp.init({
      width,
      height: minimapHeight,
      antialias: false,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      roundPixels: true,
      autoDensity: true,
      autoStart: false,
    });
    this.minimapApp.ticker.stop();
    this.minimapApp.stage.eventMode = 'none';
    this.minimapDiv.appendChild(this.minimapApp.canvas);

    // Create main timeline app
    this.app = new PIXI.Application();
    await this.app.init({
      width,
      height: mainTimelineHeight,
      antialias: false,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      roundPixels: true,
      autoDensity: true,
      autoStart: false,
    });
    this.app.ticker.stop();
    this.app.stage.eventMode = 'none';
    mainDiv.appendChild(this.app.canvas);
  }

  private setupCoordinateSystem(): void {
    if (!this.app) {
      return;
    }

    const stage = this.app.stage;
    const screenHeight = this.app.screen.height;

    // Main timeline now has its own canvas - no minimap offset needed
    // Y=0 is at bottom of main canvas, content grows upward

    this.markerContainer = new PIXI.Container();
    this.markerContainer.position.set(0, screenHeight);
    this.markerContainer.scale.y = -1;
    stage.addChild(this.markerContainer);

    this.axisContainer = new PIXI.Container();
    this.axisContainer.position.set(0, screenHeight);
    this.axisContainer.scale.y = -1;
    stage.addChild(this.axisContainer);

    this.worldContainer = new PIXI.Container();
    this.worldContainer.position.set(0, screenHeight);
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
        onClick: (x: number, y: number, modifiers?: ModifierKeys) => {
          this.handleClick(x, y, modifiers);
        },
        onDoubleClick: (x: number, y: number) => {
          this.handleDoubleClick(x, y);
        },
        onMouseLeave: () => {
          // Clear cursor position when mouse leaves main timeline
          this.cursorTimeNs = null;
          this.requestRender();

          if (this.callbacks.onMouseMove) {
            this.callbacks.onMouseMove(0, 0, null, null);
          }
        },
        onDragStart: () => {
          // Cancel any keyboard pan animation when user starts dragging
          this.viewportAnimator?.cancel();
        },
        onContextMenu: (screenX: number, screenY: number, clientX: number, clientY: number) => {
          this.handleContextMenu(screenX, screenY, clientX, clientY);
        },
        onMeasureStart: (screenX: number) => {
          this.handleMeasureStart(screenX);
        },
        onMeasureUpdate: (screenX: number) => {
          this.handleMeasureUpdate(screenX);
        },
        onMeasureEnd: () => {
          this.handleMeasureEnd();
        },
        onMeasureCancel: () => {
          this.clearMeasurement();
        },
        onAreaZoomStart: (screenX: number) => {
          this.handleAreaZoomStart(screenX);
        },
        onAreaZoomUpdate: (screenX: number) => {
          this.handleAreaZoomUpdate(screenX);
        },
        onAreaZoomEnd: () => {
          this.handleAreaZoomEnd();
        },
        onAreaZoomCancel: () => {
          this.clearAreaZoom();
        },
        onResizeStart: (screenX: number, edge: 'left' | 'right') => {
          this.handleResizeStart(screenX, edge);
        },
        onResizeUpdate: (screenX: number) => {
          this.handleResizeUpdate(screenX);
        },
        onResizeEnd: () => {
          this.handleResizeEnd();
        },
        getMeasurementResizeEdge: (screenX: number) => {
          return this.getMeasurementResizeEdge(screenX);
        },
      },
    );
  }

  private setupKeyboardHandler(): void {
    if (!this.container || !this.viewport || !this.app?.canvas) {
      return;
    }

    const canvas = this.app.canvas as HTMLCanvasElement;

    // Make container focusable for keyboard events
    this.container.setAttribute('tabindex', '0');
    this.container.style.outline = 'none'; // Remove focus outline

    // Auto-focus on click
    canvas.addEventListener('mousedown', () => {
      this.container?.focus();
    });

    this.keyboardHandler = new KeyboardHandler(this.container, this.viewport, {
      onPan: (deltaX: number, deltaY: number) => {
        if (!this.viewport || !this.viewportAnimator) {
          return;
        }

        // Use animated pan via chase animation for smooth keyboard panning
        this.viewportAnimator.addToTarget(this.viewport, deltaX, deltaY, () =>
          this.notifyViewportChange(),
        );
      },
      onZoom: (direction: 'in' | 'out') => {
        if (!this.viewport || !this.viewportAnimator) {
          return;
        }

        const factor =
          direction === 'in' ? KEYBOARD_CONSTANTS.zoomFactor : 1 / KEYBOARD_CONSTANTS.zoomFactor;

        // Use animated zoom via chase animation for smooth keyboard zooming
        this.viewportAnimator.multiplyZoomTarget(this.viewport, factor, () =>
          this.notifyViewportChange(),
        );
      },
      onResetZoom: () => {
        if (!this.viewport) {
          return;
        }

        // Cancel any keyboard pan animation since reset changes the entire viewport
        this.viewportAnimator?.cancel();

        this.viewport.resetZoom();
        this.notifyViewportChange();
      },
      onEscape: () => {
        // Clear in order: measurement → selection → search
        if (this.measurementManager?.hasMeasurement()) {
          this.clearMeasurement();
        } else if (this.selectionManager?.hasAnySelection()) {
          this.clearSelection();
        } else {
          this.clearSearch();
        }
      },
      onMarkerNav: (direction: MarkerNavDirection) => {
        return this.navigateMarker(direction);
      },
      onFrameNav: (direction: FrameNavDirection) => {
        return this.navigateFrame(direction);
      },
      onJumpToCallTree: () => {
        // Jump to call tree for selected frame or marker
        const selectedNode = this.selectionManager?.getSelected();
        if (selectedNode && this.callbacks.onJumpToCallTree) {
          this.callbacks.onJumpToCallTree(selectedNode.data);
          return;
        }

        // Jump to call tree for selected marker
        const selectedMarker = this.selectionManager?.getSelectedMarker();
        if (selectedMarker && this.callbacks.onJumpToCallTreeForMarker) {
          this.callbacks.onJumpToCallTreeForMarker(selectedMarker);
        }
      },
      onFocus: () => {
        // Focus (zoom to fit) on selected frame or marker
        if (this.selectionManager?.hasSelection()) {
          this.focusOnSelectedFrame();
        } else if (this.selectionManager?.hasMarkerSelection()) {
          this.focusOnSelectedMarker();
        }
      },
      onCopy: () => {
        // Copy selected frame name
        const selectedNode = this.selectionManager?.getSelected();
        if (selectedNode && this.callbacks.onCopy) {
          this.callbacks.onCopy(selectedNode.data);
          return;
        }

        // Copy selected marker summary
        const selectedMarker = this.selectionManager?.getSelectedMarker();
        if (selectedMarker && this.callbacks.onCopyMarker) {
          this.callbacks.onCopyMarker(selectedMarker);
        }
      },

      // Minimap keyboard callbacks
      isInMinimapArea: () => this.isMouseInMinimap,

      onMinimapPanViewport: (deltaTimeNs: number) => {
        if (!this.viewport || !this.viewportAnimator) {
          return;
        }
        // Convert time delta to pixel delta using current zoom
        const viewportState = this.viewport.getState();
        const deltaX = deltaTimeNs * viewportState.zoom;

        // Use animated pan via chase animation for smooth keyboard panning
        // (same as main timeline keyboard pan)
        this.viewportAnimator.addToTarget(this.viewport, deltaX, 0, () =>
          this.notifyViewportChange(),
        );
      },

      onMinimapPanDepth: (deltaY: number) => {
        if (!this.viewport || !this.viewportAnimator) {
          return;
        }
        // Use animated pan via chase animation for smooth keyboard panning
        // (same as main timeline keyboard pan)
        this.viewportAnimator.addToTarget(this.viewport, 0, deltaY, () =>
          this.notifyViewportChange(),
        );
      },

      onMinimapZoom: (direction: 'in' | 'out') => {
        if (!this.viewport || !this.viewportAnimator) {
          return;
        }

        const factor =
          direction === 'in' ? KEYBOARD_CONSTANTS.zoomFactor : 1 / KEYBOARD_CONSTANTS.zoomFactor;

        // Use animated zoom via chase animation for smooth keyboard zooming
        this.viewportAnimator.multiplyZoomTarget(this.viewport, factor, () =>
          this.notifyViewportChange(),
        );
      },

      onMinimapJumpStart: () => {
        if (!this.viewport || !this.minimapManager) {
          return;
        }

        // Get current selection width and move to start
        const selection = this.minimapManager.getSelection();
        const duration = selection.endTime - selection.startTime;

        // Set selection to start of timeline
        this.minimapManager.setSelection(0, duration);
        const newSelection = this.minimapManager.getSelection();
        this.handleMinimapSelectionChange(newSelection.startTime, newSelection.endTime);
      },

      onMinimapJumpEnd: () => {
        if (!this.viewport || !this.minimapManager || !this.index) {
          return;
        }

        // Get current selection width and move to end
        const selection = this.minimapManager.getSelection();
        const duration = selection.endTime - selection.startTime;

        // Set selection to end of timeline
        const totalDuration = this.index.totalDuration;
        this.minimapManager.setSelection(totalDuration - duration, totalDuration);
        const newSelection = this.minimapManager.getSelection();
        this.handleMinimapSelectionChange(newSelection.startTime, newSelection.endTime);
      },

      onMinimapResetZoom: () => {
        this.resetZoom();
      },
    });

    this.keyboardHandler.attach();
  }

  /**
   * Setup minimap system for Chrome DevTools-style overview navigation.
   */
  private setupMinimap(): void {
    if (!this.minimapApp || !this.index || !this.rectangleManager || !this.viewport) {
      return;
    }

    const { displayWidth } = this.viewport.getState();
    // Use full original container height for minimap sizing calculations
    const containerHeight = this.container?.getBoundingClientRect().height ?? 0;

    // Initialize minimap manager (state and coordinate transforms)
    this.minimapManager = new MinimapManager(
      this.index.totalDuration,
      this.index.maxDepth,
      displayWidth,
      containerHeight,
    );

    // Initialize density query (leverages RectangleManager's segment tree for O(B×log N) performance)
    this.minimapDensityQuery = new MinimapDensityQuery(
      this.rectangleManager.getRectsByCategory(),
      this.index.totalDuration,
      this.index.maxDepth,
      this.rectangleManager.getSegmentTree(),
    );

    // Create minimap container on minimap app's stage
    this.minimapContainer = new PIXI.Container();
    this.minimapApp.stage.addChild(this.minimapContainer);

    // Initialize minimap renderer with HTML container for lens label
    this.minimapRenderer = new MinimapRenderer(this.minimapContainer, this.minimapDiv!);

    // Set PIXI renderer for texture caching (static content optimization)
    this.minimapRenderer.setRenderer(this.minimapApp.renderer as PIXI.Renderer);

    // Initialize minimap interaction handler with minimap canvas
    if (this.minimapApp.canvas) {
      const minimapCanvas = this.minimapApp.canvas as HTMLCanvasElement;

      this.minimapInteractionHandler = new MinimapInteractionHandler(
        minimapCanvas,
        this.minimapManager,
        {
          onSelectionChange: (startTime: number, endTime: number) => {
            this.handleMinimapSelectionChange(startTime, endTime);
          },
          onZoom: (factor: number, anchorTimeNs: number) => {
            this.handleMinimapZoom(factor, anchorTimeNs);
          },
          onResetView: () => {
            this.resetZoom();
          },
          onCursorMove: (timeNs: number | null) => {
            // Minimap cursor → update cursor position for both views
            // cursorTimeNs is used by both minimap and main timeline cursor renderers
            this.cursorTimeNs = timeNs;
            this.requestRender();
          },
          onHorizontalPan: (deltaPixels: number) => {
            // Convert pixels to time using main viewport zoom (not minimap scale)
            // This makes minimap pan feel the same speed as main timeline pan
            if (!this.viewport || !this.minimapManager) {
              return;
            }
            const viewportState = this.viewport.getState();
            const deltaTime = deltaPixels / viewportState.zoom;
            this.minimapManager.moveSelection(deltaTime);
            const selection = this.minimapManager.getSelection();
            this.handleMinimapSelectionChange(selection.startTime, selection.endTime);
          },
          onDepthPan: (deltaY: number) => {
            // Y drag during Shift+move pans the main viewport vertically (depth)
            this.handleMinimapDepthPan(deltaY, true); // Drag: scaled for 1:1 mouse tracking
          },
          onDepthPositionStart: (minimapY: number) => {
            // Position lens at initial Y when 'create' drag starts
            this.handleMinimapDepthPositionStart(minimapY);
          },
        },
      );

      // Track mouse enter/leave/move for keyboard support and lens tooltip
      minimapCanvas.addEventListener('mouseenter', () => {
        this.isMouseInMinimap = true;
      });
      minimapCanvas.addEventListener('mouseleave', () => {
        this.isMouseInMinimap = false;
      });
      minimapCanvas.addEventListener('mousemove', (event) => {
        const rect = minimapCanvas.getBoundingClientRect();
        this.minimapMouseX = event.clientX - rect.left;
        this.minimapMouseY = event.clientY - rect.top;
      });

      // Focus container on minimap mousedown for keyboard support
      minimapCanvas.addEventListener('mousedown', () => {
        this.container?.focus();
      });
    }
  }

  /**
   * Handle minimap selection change (user created/moved/resized selection).
   * Updates main viewport to match the selection.
   */
  private handleMinimapSelectionChange(startTime: number, endTime: number): void {
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

    // Apply zoom and offset
    this.viewport.setZoom(newZoom);
    this.viewport.setOffset(newOffsetX, viewportState.offsetY);

    this.notifyViewportChange();
  }

  /**
   * Handle minimap zoom (wheel event on minimap).
   * Zooms both minimap and main viewport at the anchor point.
   */
  private handleMinimapZoom(factor: number, anchorTimeNs: number): void {
    if (!this.viewport) {
      return;
    }

    // Convert anchor time to screen X in main viewport
    const viewportState = this.viewport.getState();
    const anchorScreenX = anchorTimeNs * viewportState.zoom - viewportState.offsetX;

    // Apply zoom with anchor
    this.viewport.zoomByFactor(factor, anchorScreenX);

    this.notifyViewportChange();
  }

  /**
   * Handle minimap depth pan (Y drag during move/create operation).
   * Scrolls the main viewport vertically to show different depth levels.
   *
   * Direct manipulation: input direction matches lens visual movement.
   * Positive deltaY (drag down) → lens moves down visually
   * Negative deltaY (drag up) → lens moves up visually
   *
   * @param deltaY - Pixel delta from input
   * @param scaled - If true, scale deltaY so lens follows mouse 1:1 (for drag).
   *                 If false, use deltaY directly as viewport pixels (for keyboard).
   */
  private handleMinimapDepthPan(deltaY: number, scaled: boolean): void {
    if (!this.viewport) {
      return;
    }

    let effectiveDelta = deltaY;

    if (scaled && this.minimapManager && this.index) {
      // Scale deltaY so lens follows mouse 1:1 on minimap
      // Minimap compresses the full depth range into a small chart area
      const minimapChartHeight = this.minimapManager.getChartHeight();
      const totalDepthHeight = (this.index.maxDepth + 1) * TIMELINE_CONSTANTS.EVENT_HEIGHT;
      const scale = minimapChartHeight > 0 ? totalDepthHeight / minimapChartHeight : 1;
      // Apply slight damping (0.9) for smoother feel
      effectiveDelta = deltaY * scale * 0.9;
    }

    // Direct manipulation: add deltaY so drag direction matches lens movement
    const viewportState = this.viewport.getState();
    const newOffsetY = viewportState.offsetY + effectiveDelta;

    // Apply new offset (viewport clamps to valid bounds)
    this.viewport.setOffset(viewportState.offsetX, newOffsetY);

    this.notifyViewportChange();
  }

  /**
   * Handle initial depth positioning when 'create' drag starts on minimap.
   * Positions the lens so it starts at the clicked Y position.
   *
   * @param minimapY - Y coordinate in minimap where drag started
   */
  private handleMinimapDepthPositionStart(minimapY: number): void {
    if (!this.viewport || !this.minimapManager || !this.index) {
      return;
    }

    const chartHeight = this.minimapManager.getChartHeight();
    const minimapHeight = this.minimapManager.getHeight();
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
    // Top of chart (chartTop) = maxDepth, bottom of chart (chartBottom) = depth 0
    const yRatio = (clampedY - chartTop) / chartHeight;
    const clickDepth = maxDepth * (1 - yRatio);

    // Determine which edge of the lens should be at the click position
    // If clicking in top half of chart → position lens TOP at click (show high depths)
    // If clicking in bottom half → position lens BOTTOM at click (show low depths)
    const isTopHalf = yRatio < 0.5;

    let targetDepth: number;
    if (isTopHalf) {
      // Click near top: lens top edge at click, so bottom of visible range is clickDepth - visibleDepths
      // But we want the TOP of the lens at clickDepth, so the viewport shows clickDepth at top
      targetDepth = clickDepth - visibleDepths;
    } else {
      // Click near bottom: lens bottom edge at click, viewport shows clickDepth at bottom
      targetDepth = clickDepth;
    }

    // Apply edge snapping
    const distFromTop = clampedY - chartTop;
    const distFromBottom = chartBottom - clampedY;

    if (distFromTop < SNAP_THRESHOLD) {
      // Snap to top: show maximum depths (lens at very top)
      targetDepth = maxDepth - visibleDepths;
    } else if (distFromBottom < SNAP_THRESHOLD) {
      // Snap to bottom: show depth 0 (lens at very bottom)
      targetDepth = 0;
    }

    // Convert target depth to offsetY
    // offsetY = -depth * eventHeight (negative because offsetY <= 0)
    const newOffsetY = -Math.max(0, targetDepth) * eventHeight;

    // Apply new offset (viewport clamps to valid bounds)
    this.viewport.setOffset(viewportState.offsetX, newOffsetY);
    this.notifyViewportChange();
  }

  private handleMouseMove(screenX: number, screenY: number): void {
    if (!this.viewport || !this.index || !this.hitTestManager) {
      return;
    }

    const viewportState = this.viewport.getState();
    const depth = this.viewport.screenYToDepth(screenY);
    const maxDepth = this.index.maxDepth;

    const { event, marker } = this.hitTestManager.hitTest(
      screenX,
      screenY,
      depth,
      viewportState,
      maxDepth,
    );

    // Update cursor
    if (this.interactionHandler) {
      this.interactionHandler.updateCursor(event !== null || marker !== null);
    }

    // Notify callback
    if (this.callbacks.onMouseMove) {
      this.callbacks.onMouseMove(screenX, screenY, event, marker);
    }
  }

  private handleClick(screenX: number, screenY: number, modifiers?: ModifierKeys): void {
    if (!this.viewport || !this.index || !this.hitTestManager) {
      return;
    }

    const viewportState = this.viewport.getState();
    const depth = this.viewport.screenYToDepth(screenY);
    const maxDepth = this.index.maxDepth;

    const { event, marker } = this.hitTestManager.hitTest(
      screenX,
      screenY,
      depth,
      viewportState,
      maxDepth,
    );

    // Update selection based on click target
    if (event) {
      // Find the TreeNode for this LogEvent using original reference
      const treeNode = this.selectionManager?.findByOriginal(event);
      if (treeNode) {
        this.selectFrame(treeNode);
      }
    } else if (marker) {
      // Clicked on a marker - select it
      this.selectMarker(marker);
    } else {
      // Clicked on empty space - check if inside measurement area
      if (this.measurementManager?.hasMeasurement()) {
        const measurement = this.measurementManager.getState();
        if (measurement) {
          const clickTime = this.screenXToTime(screenX);
          const isInsideMeasurement =
            clickTime >= measurement.startTime && clickTime <= measurement.endTime;
          if (!isInsideMeasurement) {
            // Clicked outside measurement - clear it
            this.clearMeasurement();
            return;
          }
          // Clicked inside measurement - don't clear, allow frame selection below
        }
      }
      this.clearSelection();
    }

    // Notify callback
    if (this.callbacks.onClick) {
      this.callbacks.onClick(screenX, screenY, event, marker, modifiers);
    }
  }

  /**
   * Handle double-click - focus (zoom to fit) on the clicked event or marker.
   * When clicking on a bucket, focuses on the same "best event" that the tooltip displays.
   * If double-click is inside a measurement range, zooms to the measurement.
   */
  private handleDoubleClick(screenX: number, screenY: number): void {
    if (!this.viewport || !this.index || !this.hitTestManager) {
      return;
    }

    // Check if double-click is inside measurement range first
    if (this.measurementManager?.hasMeasurement()) {
      const measurement = this.measurementManager.getState();
      if (measurement) {
        const clickTime = this.screenXToTime(screenX);
        if (clickTime >= measurement.startTime && clickTime <= measurement.endTime) {
          // Zoom to measurement range
          this.zoomToMeasurement();
          return;
        }
      }
    }

    const viewportState = this.viewport.getState();
    const depth = this.viewport.screenYToDepth(screenY);
    const maxDepth = this.index.maxDepth;

    const { event, marker } = this.hitTestManager.hitTest(
      screenX,
      screenY,
      depth,
      viewportState,
      maxDepth,
    );

    // Handle event double-click
    if (event) {
      // Find the TreeNode for this LogEvent
      const treeNode = this.selectionManager?.findByOriginal(event);
      if (!treeNode) {
        return;
      }

      // Select the frame first (so it's highlighted after focus)
      this.selectFrame(treeNode);

      // Focus on the individual event (zoom to fit)
      this.focusOnSelectedFrame();
      return;
    }

    // Handle marker double-click
    if (marker) {
      // Select the marker first (so it's highlighted after focus)
      this.selectMarker(marker);

      // Focus on the marker (zoom to fit)
      this.focusOnSelectedMarker();
    }
  }

  /**
   * Handle right-click (context menu) on the timeline.
   * If clicking on an event, selects it and notifies callback.
   * If clicking on a marker, selects it and notifies callback.
   * If clicking on empty space, notifies callback with null.
   *
   * @param screenX - Canvas-relative X coordinate (for hit testing)
   * @param screenY - Canvas-relative Y coordinate (for hit testing)
   * @param clientX - Client X coordinate (for menu positioning, from original event)
   * @param clientY - Client Y coordinate (for menu positioning, from original event)
   */
  private handleContextMenu(
    screenX: number,
    screenY: number,
    clientX: number,
    clientY: number,
  ): void {
    if (!this.viewport || !this.index || !this.hitTestManager) {
      return;
    }

    const viewportState = this.viewport.getState();
    const depth = this.viewport.screenYToDepth(screenY);
    const maxDepth = this.index.maxDepth;

    // Use screenX/screenY for hit testing
    const { event, marker } = this.hitTestManager.hitTest(
      screenX,
      screenY,
      depth,
      viewportState,
      maxDepth,
    );

    // Handle event context menu
    if (event) {
      // Find the TreeNode for this LogEvent
      const treeNode = this.selectionManager?.findByOriginal(event);
      if (!treeNode) {
        return;
      }

      // Select the frame (so it's highlighted when menu appears)
      this.selectFrame(treeNode);

      // Notify callback with selected event data
      // - screenX/screenY: canvas-relative coordinates for tooltip positioning (same as hover)
      // - clientX/clientY: window coordinates for context menu positioning
      if (this.callbacks.onContextMenu) {
        this.callbacks.onContextMenu(treeNode.data, screenX, screenY, clientX, clientY);
      }
      return;
    }

    // Handle marker context menu
    if (marker) {
      // Select the marker (so it's highlighted when menu appears)
      this.selectMarker(marker);

      // Notify callback with selected marker data
      if (this.callbacks.onContextMenu) {
        this.callbacks.onContextMenu(marker, screenX, screenY, clientX, clientY);
      }
      return;
    }

    // Empty space click - notify callback with null
    if (this.callbacks.onContextMenu) {
      this.callbacks.onContextMenu(null, screenX, screenY, clientX, clientY);
    }
  }

  // ============================================================================
  // MEASUREMENT HANDLERS
  // ============================================================================

  /**
   * Convert screen X coordinate to timeline time in nanoseconds.
   */
  private screenXToTime(screenX: number): number {
    if (!this.viewport) {
      return 0;
    }
    const viewportState = this.viewport.getState();
    // screenX is relative to canvas, offsetX is the viewport scroll position
    return (screenX + viewportState.offsetX) / viewportState.zoom;
  }

  /**
   * Handle measurement start (Shift+drag began).
   * Clears any existing selection (measurement and selection are mutually exclusive).
   */
  private handleMeasureStart(screenX: number): void {
    if (!this.measurementManager) {
      return;
    }

    // DON'T clear selection - measurement and selection can coexist

    // Clear search when starting measurement (search highlights conflict with measurement overlay)
    this.clearSearch();

    // Start measurement - clamp to timeline bounds
    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.index?.totalDuration ?? Infinity, timeNs));
    this.measurementManager.start(clampedTime);

    // Notify callback
    this.callbacks.onMeasurementChange?.(this.measurementManager.getState());

    this.requestRender();
  }

  /**
   * Handle measurement update (Shift+drag continuing).
   */
  private handleMeasureUpdate(screenX: number): void {
    if (!this.measurementManager) {
      return;
    }

    // Clamp to timeline bounds (0 to totalDuration)
    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.index?.totalDuration ?? Infinity, timeNs));
    this.measurementManager.update(clampedTime);

    // Notify callback
    this.callbacks.onMeasurementChange?.(this.measurementManager.getState());

    this.requestRender();
  }

  /**
   * Handle measurement end (mouse released).
   * Measurement persists until cleared.
   */
  private handleMeasureEnd(): void {
    if (!this.measurementManager) {
      return;
    }

    this.measurementManager.finish();

    // Notify callback
    this.callbacks.onMeasurementChange?.(this.measurementManager.getState());

    this.requestRender();
  }

  /**
   * Clear the current measurement.
   * Called when user presses Escape, clicks elsewhere, or starts a new selection.
   */
  public clearMeasurement(): void {
    if (!this.measurementManager?.hasMeasurement()) {
      return;
    }

    this.measurementManager.clear();
    this.measurementRenderer?.clear();

    // Notify callback
    this.callbacks.onMeasurementChange?.(null);

    this.requestRender();
  }

  /**
   * Check if there is an active measurement.
   */
  public hasMeasurement(): boolean {
    return this.measurementManager?.hasMeasurement() ?? false;
  }

  // ============================================================================
  // AREA ZOOM HANDLERS
  // ============================================================================

  /**
   * Handle area zoom start (Alt+drag began).
   * Clears any existing measurement.
   */
  private handleAreaZoomStart(screenX: number): void {
    if (!this.areaZoomManager) {
      return;
    }

    // Clear measurement when starting area zoom (they can't coexist visually)
    this.clearMeasurement();

    // Clear search when starting area zoom
    this.clearSearch();

    // Start area zoom - clamp to timeline bounds
    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.index?.totalDuration ?? Infinity, timeNs));
    this.areaZoomManager.start(clampedTime);

    this.requestRender();
  }

  /**
   * Handle area zoom update (Alt+drag continuing).
   */
  private handleAreaZoomUpdate(screenX: number): void {
    if (!this.areaZoomManager) {
      return;
    }

    // Clamp to timeline bounds (0 to totalDuration)
    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.index?.totalDuration ?? Infinity, timeNs));
    this.areaZoomManager.update(clampedTime);

    this.requestRender();
  }

  /**
   * Handle area zoom end (mouse released after drag).
   * Zooms to the selected area and clears the overlay.
   */
  private handleAreaZoomEnd(): void {
    if (!this.areaZoomManager || !this.viewport || !this.index) {
      this.clearAreaZoom();
      return;
    }

    const state = this.areaZoomManager.getState();
    if (state && state.endTime - state.startTime > 0) {
      // Zoom to the selected area (exact fit, no padding)
      const middleDepth = Math.floor(this.index.maxDepth / 2);
      this.viewport.focusOnEvent(
        state.startTime,
        state.endTime - state.startTime,
        middleDepth,
        0, // 100% zoom, no padding
      );

      this.notifyViewportChange();
    }

    // Clear the area zoom overlay
    this.clearAreaZoom();
  }

  /**
   * Clear the current area zoom overlay.
   */
  private clearAreaZoom(): void {
    if (!this.areaZoomManager) {
      return;
    }

    this.areaZoomManager.clear();
    this.areaZoomRenderer?.clear();

    this.requestRender();
  }

  // ============================================================================
  // RESIZE HANDLERS (drag existing measurement edge)
  // ============================================================================

  /**
   * Check if screenX is near a measurement resize edge.
   * Returns 'left' or 'right' if near an edge, null otherwise.
   */
  private getMeasurementResizeEdge(screenX: number): 'left' | 'right' | null {
    if (!this.measurementManager?.hasMeasurement() || !this.viewport) {
      return null;
    }

    const measurement = this.measurementManager.getState();
    if (!measurement || measurement.isActive) {
      // Only finished measurements can be resized
      return null;
    }

    const viewportState = this.viewport.getState();
    const screenStartX = measurement.startTime * viewportState.zoom - viewportState.offsetX;
    const screenEndX = measurement.endTime * viewportState.zoom - viewportState.offsetX;

    const threshold = 8; // px
    if (Math.abs(screenX - screenStartX) <= threshold) {
      return 'left';
    }
    if (Math.abs(screenX - screenEndX) <= threshold) {
      return 'right';
    }
    return null;
  }

  /**
   * Handle resize start (click on measurement edge).
   */
  private handleResizeStart(_screenX: number, edge: 'left' | 'right'): void {
    if (!this.measurementManager) {
      return;
    }

    const measurement = this.measurementManager.getState();
    if (!measurement) {
      return;
    }

    this.resizeEdge = edge;
    // Store the anchor (the edge NOT being dragged)
    this.resizeAnchorTime = edge === 'left' ? measurement.endTime : measurement.startTime;

    this.requestRender();
  }

  /**
   * Handle resize update (dragging measurement edge).
   */
  private handleResizeUpdate(screenX: number): void {
    if (!this.measurementManager || this.resizeAnchorTime === null) {
      return;
    }

    const timeNs = this.screenXToTime(screenX);
    const clampedTime = Math.max(0, Math.min(this.index?.totalDuration ?? Infinity, timeNs));

    // Update measurement using anchor - dragged time becomes one edge, anchor is the other
    this.measurementManager.setEdges(clampedTime, this.resizeAnchorTime);

    // Notify callback
    this.callbacks.onMeasurementChange?.(this.measurementManager.getState());

    this.requestRender();
  }

  /**
   * Handle resize end (mouse released after dragging edge).
   */
  private handleResizeEnd(): void {
    this.resizeEdge = null;
    this.resizeAnchorTime = null;

    // Notify callback with final measurement state
    this.callbacks.onMeasurementChange?.(this.measurementManager?.getState() ?? null);

    this.requestRender();
  }

  /**
   * Zoom to fit the current measurement range.
   * Used by double-click inside measurement and zoom icon in label.
   */
  public zoomToMeasurement(): void {
    if (!this.measurementManager?.hasMeasurement() || !this.viewport || !this.index) {
      return;
    }

    const measurement = this.measurementManager.getState();
    if (!measurement) {
      return;
    }

    // Use middle depth for vertical centering
    const middleDepth = Math.floor(this.index.maxDepth / 2);

    // Focus on the measurement range (zoom to fit exactly, no padding)
    this.viewport.focusOnEvent(
      measurement.startTime,
      measurement.endTime - measurement.startTime,
      middleDepth,
      0, // 100% zoom, no padding
    );

    this.notifyViewportChange();
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Compute the current highlight mode based on actual state.
   * Selection (frame or marker) takes priority over search.
   *
   * @returns Current highlight mode
   */
  private getHighlightMode(): 'none' | 'search' | 'selection' {
    if (this.selectionManager?.hasAnySelection()) {
      return 'selection';
    }
    const cursor = this.newSearchManager?.getCursor();
    if (cursor && cursor.total > 0) {
      return 'search';
    }
    return 'none';
  }

  /**
   * Notify viewport change and request render.
   * Consolidates duplicated callback pattern.
   */
  private notifyViewportChange(): void {
    this.requestRender();
    if (this.callbacks.onViewportChange && this.viewport) {
      this.callbacks.onViewportChange(this.viewport.getState());
    }
  }

  // ============================================================================
  // SELECTION METHODS
  // ============================================================================

  /**
   * Select a frame (TreeNode).
   * Updates visual highlight and notifies callback.
   * Selection takes priority over search highlight (via getHighlightMode()).
   *
   * @param node - TreeNode to select
   */
  private selectFrame(node: TreeNode<E>): void {
    // DON'T clear measurement - selection and measurement can coexist

    this.selectionManager?.select(node);

    // Notify callback
    if (this.callbacks.onSelect) {
      this.callbacks.onSelect(node.data);
    }

    this.requestRender();
  }

  /**
   * Clear the current selection (frame or marker).
   * If search has matches, search highlight will automatically show via getHighlightMode().
   */
  private clearSelection(): void {
    const hadFrameSelection = this.selectionManager?.hasSelection();
    const hadMarkerSelection = this.selectionManager?.hasMarkerSelection();

    if (!hadFrameSelection && !hadMarkerSelection) {
      return;
    }

    this.selectionManager?.clear();

    // Clear selection renderer
    if (this.selectionRenderer) {
      this.selectionRenderer.clear();
    }

    // Notify callbacks
    if (hadFrameSelection && this.callbacks.onSelect) {
      this.callbacks.onSelect(null);
    }
    if (hadMarkerSelection && this.callbacks.onMarkerSelect) {
      this.callbacks.onMarkerSelect(null);
    }

    this.requestRender();
  }

  /**
   * Select a marker.
   * Updates visual highlight and notifies callback.
   * Selection takes priority over search highlight (via getHighlightMode()).
   *
   * @param marker - TimelineMarker to select
   */
  private selectMarker(marker: TimelineMarker): void {
    // DON'T clear measurement - selection and measurement can coexist

    this.selectionManager?.selectMarker(marker);

    // Notify callback
    if (this.callbacks.onMarkerSelect) {
      this.callbacks.onMarkerSelect(marker);
    }

    this.requestRender();
  }

  /**
   * Navigate marker selection.
   * Called by keyboard handler for arrow key navigation on markers.
   *
   * @param direction - Navigation direction ('left' for previous, 'right' for next)
   * @returns true if navigation was handled (marker is selected)
   */
  private navigateMarker(direction: MarkerNavDirection): boolean {
    // No navigation if no marker is selected
    if (!this.selectionManager?.hasMarkerSelection()) {
      return false;
    }

    // Navigate and get the new marker (or null if at boundary)
    const nextMarker = this.selectionManager.navigateMarker(direction);

    // If navigation found a valid marker, center viewport and notify
    if (nextMarker) {
      // Notify callback
      if (this.callbacks.onMarkerSelect) {
        this.callbacks.onMarkerSelect(nextMarker);
      }

      // Always request render to show updated selection highlight
      this.requestRender();

      // Auto-center viewport on the newly selected marker
      this.centerOnSelectedMarker();

      // Notify navigation callback for tooltip
      if (this.callbacks.onMarkerNavigate && this.viewport) {
        const screenX = this.viewport.calculateVisibleCenterX(nextMarker.startTime, 0);
        // Markers span full height - position tooltip near top of visible area
        const screenY = 50;
        this.callbacks.onMarkerNavigate(nextMarker, screenX, screenY);
      }
    }

    // Return true if we have a marker selection (even if we couldn't navigate further)
    // This prevents falling through to frame navigation or pan when at a boundary
    return true;
  }

  /**
   * Navigate frame selection using tree navigation.
   * Called by keyboard handler for arrow key navigation.
   *
   * @param direction - Navigation direction
   * @returns true if navigation was handled (selection changed or stayed at boundary)
   */
  private navigateFrame(direction: FrameNavDirection): boolean {
    // No navigation if nothing is selected
    if (!this.selectionManager?.hasSelection()) {
      return false;
    }

    // Navigate and get the new node (or null if at boundary)
    const nextNode = this.selectionManager.navigate(direction);

    // If navigation found a valid node, center viewport and notify
    if (nextNode) {
      // Notify callback
      if (this.callbacks.onSelect) {
        this.callbacks.onSelect(nextNode.data);
      }

      // Always request render to show updated selection highlight
      // (centerOnSelectedFrame only renders if viewport moves)
      this.requestRender();

      // Auto-center viewport on the newly selected frame
      this.centerOnSelectedFrame();

      // Notify navigation callback for tooltip (similar to search navigation)
      if (this.callbacks.onFrameNavigate && this.viewport) {
        const depth = nextNode.depth ?? 0;
        const screenX = this.viewport.calculateVisibleCenterX(
          nextNode.data.timestamp,
          nextNode.data.duration,
        );
        const screenY = this.viewport.depthToScreenY(depth);
        this.callbacks.onFrameNavigate(nextNode.data, screenX, screenY, depth);
      }
    }

    // Return true if we have a selection (even if we couldn't navigate further)
    // This prevents falling through to pan when at a boundary (e.g., at root)
    return true;
  }

  /**
   * Center viewport on the currently selected frame.
   * Uses smooth animation when navigating to off-screen frames.
   */
  private centerOnSelectedFrame(): void {
    const selectedNode = this.selectionManager?.getSelected();
    if (!selectedNode || !this.viewport) {
      return;
    }

    const event = selectedNode.data;
    const depth = selectedNode.depth ?? 0;

    // Calculate target offset (without applying it)
    const targetOffset = this.viewport.calculateCenterOffset(
      event.timestamp,
      event.duration,
      depth,
    );

    // Check if viewport needs to move
    const currentState = this.viewport.getState();
    const needsAnimation =
      Math.abs(targetOffset.x - currentState.offsetX) > 1 ||
      Math.abs(targetOffset.y - currentState.offsetY) > 1;

    if (needsAnimation && this.viewportAnimator) {
      // Animate to target position (300ms)
      this.viewportAnimator.animate(this.viewport, targetOffset.x, targetOffset.y, 300, () =>
        this.notifyViewportChange(),
      );
    } else if (needsAnimation) {
      // Fallback: instant move if no animator
      this.viewport.centerOnEvent(event.timestamp, event.duration, depth);
      this.notifyViewportChange();
    }
  }

  /**
   * Focus viewport on the currently selected frame (zoom to fit).
   * Calculates optimal zoom to fit the frame with padding.
   */
  public focusOnSelectedFrame(): void {
    const selectedNode = this.selectionManager?.getSelected();
    if (!selectedNode || !this.viewport) {
      return;
    }

    const event = selectedNode.data;
    const depth = selectedNode.depth ?? 0;

    // Focus on the event (zoom to fit with padding)
    this.viewport.focusOnEvent(event.timestamp, event.duration, depth);
    this.notifyViewportChange();
  }

  /**
   * Center viewport on the currently selected marker.
   * Uses smooth animation when navigating to off-screen markers.
   */
  private centerOnSelectedMarker(): void {
    const selectedMarker = this.selectionManager?.getSelectedMarker();
    if (!selectedMarker || !this.viewport || !this.index) {
      return;
    }

    // Calculate marker duration (extends to next marker or timeline end)
    const markers = this.selectionManager?.getMarkers() ?? [];
    const markerIndex = markers.findIndex((m) => m.id === selectedMarker.id);
    const nextMarker = markers[markerIndex + 1];
    const markerEnd = nextMarker?.startTime ?? this.index.totalDuration;
    const duration = markerEnd - selectedMarker.startTime;

    // Use middle depth for centering (markers span all depths)
    const middleDepth = Math.floor(this.index.maxDepth / 2);

    // Calculate target offset (without applying it)
    const targetOffset = this.viewport.calculateCenterOffset(
      selectedMarker.startTime,
      duration,
      middleDepth,
    );

    // Check if viewport needs to move
    const currentState = this.viewport.getState();
    const needsAnimation =
      Math.abs(targetOffset.x - currentState.offsetX) > 1 ||
      Math.abs(targetOffset.y - currentState.offsetY) > 1;

    if (needsAnimation && this.viewportAnimator) {
      // Animate to target position (300ms)
      this.viewportAnimator.animate(this.viewport, targetOffset.x, targetOffset.y, 300, () =>
        this.notifyViewportChange(),
      );
    } else if (needsAnimation) {
      // Fallback: instant move if no animator
      this.viewport.centerOnEvent(selectedMarker.startTime, duration, middleDepth);
      this.notifyViewportChange();
    }
  }

  /**
   * Focus viewport on the currently selected marker (zoom to fit).
   * Calculates optimal zoom to fit the marker with padding.
   */
  public focusOnSelectedMarker(): void {
    const selectedMarker = this.selectionManager?.getSelectedMarker();
    if (!selectedMarker || !this.viewport || !this.index) {
      return;
    }

    // Calculate marker duration (extends to next marker or timeline end)
    const markers = this.selectionManager?.getMarkers() ?? [];
    const markerIndex = markers.findIndex((m) => m.id === selectedMarker.id);
    const nextMarker = markers[markerIndex + 1];
    const markerEnd = nextMarker?.startTime ?? this.index.totalDuration;
    const duration = markerEnd - selectedMarker.startTime;

    // Use middle depth for focusing (markers span all depths)
    const middleDepth = Math.floor(this.index.maxDepth / 2);

    // Focus on the marker (zoom to fit with padding)
    this.viewport.focusOnEvent(selectedMarker.startTime, duration, middleDepth);
    this.notifyViewportChange();
  }

  /**
   * Get the currently selected node (frame).
   *
   * @returns Currently selected TreeNode, or null if none
   */
  public getSelectedNode(): TreeNode<E> | null {
    return this.selectionManager?.getSelected() ?? null;
  }

  /**
   * Get the currently selected marker.
   *
   * @returns Currently selected TimelineMarker, or null if none
   */
  public getSelectedMarker(): TimelineMarker | null {
    return this.selectionManager?.getSelectedMarker() ?? null;
  }

  /**
   * Reset viewport to show entire timeline.
   * Cancels any active animations.
   */
  public resetZoom(): void {
    if (!this.viewport) {
      return;
    }

    // Cancel any active animation since reset changes the entire viewport
    this.viewportAnimator?.cancel();

    this.viewport.resetZoom();
    this.notifyViewportChange();
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
        color: cssColorToPixi(colors[category] || '#000000'),
        rectangles: [],
        isDirty: true,
      });
    }

    // Build initial batch colors cache
    const batchColorsCache = this.buildBatchColorsCache(batches);

    this.state = {
      events,
      viewport: this.viewport.getState(),
      batches,
      batchColorsCache,
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
   * Build batch colors cache from batches map.
   * Used for bucket color resolution without recreating Map every frame.
   */
  private buildBatchColorsCache(
    batches: Map<string, { color: number }>,
  ): Map<string, { color: number }> {
    const cache = new Map<string, { color: number }>();
    for (const [category, batch] of batches) {
      cache.set(category, { color: batch.color });
    }
    return cache;
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

    // Main timeline has its own canvas - position at bottom of canvas (no minimap offset)
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

    // Use cached batch colors for bucket color resolution (built in setColors/init)
    const { visibleRects, buckets } = this.rectangleManager.getCulledRectangles(
      viewportState,
      this.state.batchColorsCache,
    );

    // Update hit test manager with current render data
    if (this.hitTestManager) {
      this.hitTestManager.setVisibleRects(visibleRects);
      this.hitTestManager.setBuckets(buckets);
    }

    // Render events (with or without search styling)
    const cursor = this.newSearchManager?.getCursor();

    if (cursor && cursor.total > 0) {
      // Search mode: render with desaturation (including buckets)
      const matchedEventIds = cursor.getMatchedEventIds();
      this.searchStyleRenderer!.render(visibleRects, matchedEventIds, buckets, viewportState);

      // Clear normal renderer when in search mode
      if (this.batchRenderer) {
        this.batchRenderer.clear();
      }
    } else {
      // Normal mode: render with original colors and buckets
      this.batchRenderer.render(visibleRects, buckets, viewportState);

      // Clear search overlays when not in search mode
      if (this.searchStyleRenderer) {
        this.searchStyleRenderer.clear();
      }
    }

    // Render text labels (with or without search styling)
    if (cursor && cursor.total > 0) {
      // Search mode: SearchTextLabelRenderer coordinates both matched and unmatched labels
      const matchedEventIds = cursor.getMatchedEventIds();
      if (this.searchTextLabelRenderer) {
        this.searchTextLabelRenderer.render(visibleRects, matchedEventIds, viewportState);
      }
    } else {
      // Normal mode: render all visible text
      if (this.textLabelRenderer) {
        this.textLabelRenderer.render(visibleRects, viewportState);
      }

      // Clear search text renderer when not in search mode
      if (this.searchTextLabelRenderer) {
        this.searchTextLabelRenderer.clear();
      }
    }

    // Render only ONE highlight based on computed mode (selection takes priority)
    const highlightMode = this.getHighlightMode();
    if (highlightMode === 'selection') {
      // Selection highlight mode: show selection highlight
      // Pass selection state from SelectionManager (single source of truth)
      const selectedNode = this.selectionManager?.getSelected() as TreeNode<EventNode> | null;
      const selectedMarker = this.selectionManager?.getSelectedMarker() ?? null;
      this.selectionRenderer?.render(viewportState, selectedNode, selectedMarker);
      this.searchRenderer?.clear();
    } else if (highlightMode === 'search') {
      // Search highlight mode: show search match highlight
      this.searchRenderer!.render(cursor!, viewportState);
      this.selectionRenderer?.clear();
    } else {
      // No active highlight mode: clear both
      this.searchRenderer?.clear();
      this.selectionRenderer?.clear();
    }

    // Render measurement overlay (if active)
    if (this.measurementRenderer && this.measurementManager) {
      this.measurementRenderer.render(viewportState, this.measurementManager.getState());
    }

    // Render area zoom overlay (if active)
    if (this.areaZoomRenderer && this.areaZoomManager) {
      this.areaZoomRenderer.render(viewportState, this.areaZoomManager.getState());
    }

    // Render cursor line on main timeline (bidirectional cursor mirroring)
    if (this.cursorLineRenderer) {
      this.cursorLineRenderer.render(viewportState, this.cursorTimeNs);
    }

    // Render main timeline
    this.app.render();

    // Render minimap (if initialized)
    if (
      this.minimapApp &&
      this.minimapRenderer &&
      this.minimapManager &&
      this.minimapDensityQuery
    ) {
      // Get visible depth range from viewport bounds
      const bounds = this.viewport.getBounds();

      // Sync lens position with main viewport (including Y bounds)
      this.minimapManager.setSelectionFromViewport(
        viewportState,
        bounds.depthStart,
        bounds.depthEnd,
      );

      // Query density data (cached unless display width changed)
      const densityData = this.minimapDensityQuery.query(viewportState.displayWidth);

      // Render minimap with density, markers, cursor, and interaction state
      // Show lens label only when hovering over the lens area or dragging
      const isHoveringLens =
        this.isMouseInMinimap &&
        this.minimapManager.isPointInsideLens(this.minimapMouseX, this.minimapMouseY);
      const isInteracting = isHoveringLens || this.minimapManager.isDragging();
      this.minimapRenderer.render(
        this.minimapManager,
        densityData,
        this.markers,
        this.state.batchColorsCache,
        this.cursorTimeNs,
        isInteracting,
      );

      // Render minimap app
      this.minimapApp.render();
    }
  }
}
