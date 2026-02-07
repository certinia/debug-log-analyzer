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
  HeatStripTimeSeries,
  ModifierKeys,
  TimelineMarker,
  TimelineOptions,
  TimelineState,
  TreeNode,
  ViewportState,
} from '../types/flamechart.types.js';
import { TIMELINE_CONSTANTS, TimelineError, TimelineErrorCode } from '../types/flamechart.types.js';
import type { SearchCursor, SearchOptions } from '../types/search.types.js';
import type { NavigationMaps } from '../utils/tree-converter.js';

import { MeshMarkerRenderer } from './markers/MeshMarkerRenderer.js';
import { MeshRectangleRenderer } from './MeshRectangleRenderer.js';
import { MeshAxisRenderer } from './time-axis/MeshAxisRenderer.js';

import { EventBatchRenderer } from './EventBatchRenderer.js';
import { TimelineMarkerRenderer } from './markers/TimelineMarkerRenderer.js';
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
import type { MeasurementState } from './measurement/MeasurementManager.js';
import { RectangleManager, type PrecomputedRect } from './RectangleManager.js';
import { CursorLineRenderer } from './rendering/CursorLineRenderer.js';
import { TimelineEventIndex } from './TimelineEventIndex.js';
import { TimelineViewport } from './TimelineViewport.js';
import { ViewportAnimator } from './ViewportAnimator.js';

// Orchestrators (own domain-specific state and rendering)
import { MeasurementOrchestrator } from './orchestrators/MeasurementOrchestrator.js';

import {
  calculateMinimapHeight,
  MINIMAP_GAP,
  MinimapOrchestrator,
} from './orchestrators/MinimapOrchestrator.js';

import { SearchOrchestrator } from './orchestrators/SearchOrchestrator.js';
import { SelectionOrchestrator } from './orchestrators/SelectionOrchestrator.js';

import {
  METRIC_STRIP_COLLAPSED_HEIGHT,
  METRIC_STRIP_GAP,
  MetricStripOrchestrator,
} from './metric-strip/MetricStripOrchestrator.js';

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

  // Search orchestrator (owns search state and rendering)
  private searchOrchestrator: SearchOrchestrator<E> | null = null;
  private treeNodes: TreeNode<E>[] | null = null;

  // Text label renderer (used in normal mode, shared with search orchestrator)
  private textLabelRenderer: TextLabelRenderer | null = null;

  private worldContainer: PIXI.Container | null = null;
  private axisContainer: PIXI.Container | null = null;
  private markerContainer: PIXI.Container | null = null;
  private uiContainer: PIXI.Container | null = null;
  private renderLoopId: number | null = null;
  private interactionHandler: TimelineInteractionHandler | null = null;
  private keyboardHandler: KeyboardHandler | null = null;

  private readonly markers: TimelineMarker[] = [];

  private hitTestManager: HitTestManager | null = null;

  // Selection orchestrator (owns selection state and rendering)
  private selectionOrchestrator: SelectionOrchestrator<E> | null = null;
  private viewportAnimator: ViewportAnimator | null = null;

  // Measurement orchestrator (owns measurement and area zoom state, rendering)
  private measurementOrchestrator: MeasurementOrchestrator | null = null;

  // Minimap orchestrator (owns all minimap state, rendering, and interaction)
  private minimapOrchestrator: MinimapOrchestrator | null = null;
  private minimapDiv: HTMLElement | null = null; // HTML container for minimap canvas

  // Metric strip orchestrator (owns governor limit visualization between minimap and main timeline)
  private metricStripOrchestrator: MetricStripOrchestrator | null = null;
  private metricStripDiv: HTMLElement | null = null; // HTML container for metric strip canvas
  private metricStripGapDiv: HTMLElement | null = null; // Gap element below metric strip

  // Cursor line renderer for main timeline (bidirectional cursor mirroring)
  private cursorLineRenderer: CursorLineRenderer | null = null;

  // Vertical offset from container top to main timeline canvas (minimap + metric strip + gaps)
  // Used to convert canvas-relative coordinates to container-relative for tooltip positioning
  private mainTimelineYOffset = 0;

  // Cached culled rectangles (reused when viewport unchanged - Phase 3 optimization)
  // INVARIANT: These caches are invalidated when renderDirty.culling is set to true.
  // Any code that changes viewport state must call invalidateAll() or set culling dirty flag.
  private cachedVisibleRects: Map<string, PrecomputedRect[]> | null = null;
  private cachedBuckets: Map<string, import('../types/flamechart.types.js').PixelBucket[]> | null =
    null;

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

    // Calculate minimap and metric strip heights BEFORE creating viewport
    // Viewport needs the available height for main timeline (excluding minimap + metric strip + gaps)
    // Metric strip starts collapsed, so use collapsed height for initial layout
    const minimapHeight = calculateMinimapHeight(height);
    const metricStripHeight = METRIC_STRIP_COLLAPSED_HEIGHT;
    const totalOverheadHeight = minimapHeight + MINIMAP_GAP + metricStripHeight + METRIC_STRIP_GAP;
    const mainTimelineHeight = height - totalOverheadHeight;

    // Store offset for converting canvas-relative to container-relative coordinates
    this.mainTimelineYOffset = totalOverheadHeight;

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

    // Create text label renderer (renders method names on rectangles)
    if (this.worldContainer && this.state) {
      this.textLabelRenderer = new TextLabelRenderer(this.worldContainer);
      await this.textLabelRenderer.loadFont();
      this.textLabelRenderer.setBatches(this.state.batches);

      // Enable zIndex sorting for proper layering
      this.worldContainer.sortableChildren = true;
    }

    // For mesh renderers, set stage container for clip-space rendering
    if (useMeshRenderer && this.app) {
      const stage = this.app.stage;
      if (this.batchRenderer && 'setStageContainer' in this.batchRenderer) {
        (this.batchRenderer as MeshRectangleRenderer).setStageContainer(stage);
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

    // Initialize selection orchestrator (owns selection state and rendering)
    this.setupSelection(treeNodes, maps);

    // Initialize measurement orchestrator (owns measurement and area zoom)
    this.setupMeasurement();

    // Initialize cursor line renderer (for bidirectional cursor mirroring)
    if (this.uiContainer) {
      this.cursorLineRenderer = new CursorLineRenderer(this.uiContainer);
    }

    // Initialize minimap orchestrator
    await this.setupMinimap();

    // Initialize metric strip orchestrator
    await this.setupMetricStrip();

    // Setup interaction handler
    this.setupInteractionHandler();

    // Setup keyboard handler
    this.setupKeyboardHandler();

    // Pass the same dimensions that init() used to create the viewport.
    // This ensures ResizeObserver's initial callback (which fires with current container
    // dimensions) is correctly skipped, even if DOM manipulation during init caused
    // a layout shift that changed the container size.
    this.resizeHandler = new TimelineResizeHandler(container, this, width, height);
    this.resizeHandler.setupResizeObserver();

    // Initialize search if enabled via options
    if (options.enableSearch) {
      this.setupSearch(useMeshRenderer);
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

    // Clean up selection orchestrator
    if (this.selectionOrchestrator) {
      this.selectionOrchestrator.destroy();
      this.selectionOrchestrator = null;
    }

    // Clean up measurement orchestrator
    if (this.measurementOrchestrator) {
      this.measurementOrchestrator.destroy();
      this.measurementOrchestrator = null;
    }

    // Clean up cursor line renderer
    if (this.cursorLineRenderer) {
      this.cursorLineRenderer.destroy();
      this.cursorLineRenderer = null;
    }

    // Clean up minimap orchestrator
    if (this.minimapOrchestrator) {
      this.minimapOrchestrator.destroy();
      this.minimapOrchestrator = null;
    }

    // Clean up metric strip orchestrator
    if (this.metricStripOrchestrator) {
      this.metricStripOrchestrator.destroy();
      this.metricStripOrchestrator = null;
    }

    // Clean up viewport animator
    if (this.viewportAnimator) {
      this.viewportAnimator.cancel();
      this.viewportAnimator = null;
    }

    // Clean up search orchestrator
    if (this.searchOrchestrator) {
      this.searchOrchestrator.destroy();
      this.searchOrchestrator = null;
    }

    // Clean up text label renderer (used in normal mode)
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
   * Setup search orchestrator for find and navigation functionality.
   *
   * @param useMeshRenderer - Whether to use mesh-based renderers
   */
  private setupSearch(useMeshRenderer: boolean): void {
    if (
      !this.rectangleManager ||
      !this.treeNodes ||
      !this.worldContainer ||
      !this.state ||
      !this.textLabelRenderer ||
      !this.viewport
    ) {
      throw new Error('FlameChart must be initialized before enabling search');
    }

    // Create search orchestrator with callbacks
    this.searchOrchestrator = new SearchOrchestrator<E>({
      onSearchNavigate: (event: EventNode, screenX: number, screenY: number, depth: number) => {
        this.callbacks.onSearchNavigate?.(event, screenX, screenY, depth);
      },
      onCenterOnMatch: (timestamp: number, duration: number, depth: number) => {
        this.viewport?.centerOnEvent(timestamp, duration, depth);
      },
      onClearSelection: () => {
        this.selectionOrchestrator?.clearSelection();
      },
      requestRender: () => {
        this.requestRender();
      },
    });

    // Initialize the orchestrator
    this.searchOrchestrator.init(
      this.worldContainer,
      this.treeNodes,
      this.rectangleManager,
      this.state.batches,
      this.textLabelRenderer,
      useMeshRenderer,
      this.viewport,
      this.mainTimelineYOffset,
    );

    // For mesh renderers, set stage container for clip-space rendering
    if (useMeshRenderer && this.app) {
      this.searchOrchestrator.setStageContainer(this.app.stage);
    }
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
    return this.searchOrchestrator?.search(predicate, options) ?? null;
  }

  /**
   * Get current search cursor.
   * @returns Current cursor or undefined if no active search
   */
  public getSearchCursor(): SearchCursor<E> | undefined {
    return this.searchOrchestrator?.getCursor();
  }

  /**
   * Clear current search and reset cursor.
   * If a frame is selected, selection highlight will automatically show via getHighlightMode().
   */
  public clearSearch(): void {
    this.searchOrchestrator?.clearSearch();
  }

  /**
   * Get viewport manager instance.
   */
  public getViewportManager(): TimelineViewport | null {
    return this.viewport;
  }

  /**
   * Request a redraw on next frame.
   * Default: full render (all phases dirty).
   * For optimized paths, use requestCursorRender() or requestHighlightsRender().
   */
  public requestRender(): void {
    if (!this.state) {
      return;
    }

    // Default: full render (all phases dirty)
    // Callers can use requestCursorRender/requestHighlightsRender for optimization
    this.invalidateAll();

    this.state.needsRender = true;
    this.scheduleRender();
  }

  /**
   * Request highlights render (5x faster than full render).
   * Use for selection changes when viewport hasn't changed.
   */
  private requestHighlightsRender(): void {
    if (!this.state) {
      return;
    }
    this.invalidateHighlights();
    this.state.needsRender = true;
    this.scheduleRender();
  }

  /**
   * Request cursor-only render (~1ms vs ~10ms for full render).
   * Only invalidates overlays and minimap/metric strip.
   * Reuses cached culling results - use for cursor moves on minimap/metric strip.
   */
  private requestCursorRender(): void {
    if (!this.state) {
      return;
    }
    this.state.renderDirty.overlays = true;
    this.state.renderDirty.minimap = true;
    this.state.renderDirty.metricStrip = true;
    this.state.needsRender = true;
    this.scheduleRender();
  }

  /**
   * Schedule a render on next animation frame.
   * Shared by requestRender, requestCursorRender, and requestHighlightsRender.
   */
  private scheduleRender(): void {
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

    // Calculate new minimap, metric strip, and main timeline heights
    // Query actual metric strip height (respects collapsed/expanded state)
    const minimapHeight = calculateMinimapHeight(newHeight);
    const metricStripHeight =
      this.metricStripOrchestrator?.getHeight() ?? METRIC_STRIP_COLLAPSED_HEIGHT;
    const totalOverheadHeight = minimapHeight + MINIMAP_GAP + metricStripHeight + METRIC_STRIP_GAP;
    const mainTimelineHeight = newHeight - totalOverheadHeight;

    // Update offset for converting canvas-relative to container-relative coordinates
    this.mainTimelineYOffset = totalOverheadHeight;

    // Update orchestrators with new offset
    this.selectionOrchestrator?.setMainTimelineYOffset(this.mainTimelineYOffset);
    this.searchOrchestrator?.setMainTimelineYOffset(this.mainTimelineYOffset);

    // Resize minimap orchestrator
    if (this.minimapOrchestrator) {
      this.minimapOrchestrator.resize(newWidth, newHeight);
    }

    // Resize metric strip orchestrator
    if (this.metricStripOrchestrator) {
      this.metricStripOrchestrator.resize(newWidth);
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

    // Update viewport with main timeline dimensions only
    this.viewport.setStateForResize(newWidth, mainTimelineHeight, newZoom, newOffsetX, newOffsetY);

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
    this.minimapOrchestrator?.invalidateCache();

    // Request re-render
    this.requestRender();
  }

  /**
   * Set heat strip time series data for visualization.
   * Call this after init() when log data is available.
   *
   * @param timeSeries - Heat strip time series data (generic format)
   */
  public setHeatStripTimeSeries(timeSeries: HeatStripTimeSeries | null): void {
    this.metricStripOrchestrator?.setTimeSeries(timeSeries);
    this.updateMetricStripVisibility();
  }

  /**
   * Update metric strip visibility based on whether there's data to display.
   * Hides the metric strip container and gap if no governor limit data exists.
   */
  private updateMetricStripVisibility(): void {
    const isVisible = this.metricStripOrchestrator?.getIsVisible() ?? false;
    const display = isVisible ? 'block' : 'none';

    if (this.metricStripDiv) {
      this.metricStripDiv.style.display = display;
    }
    if (this.metricStripGapDiv) {
      this.metricStripGapDiv.style.display = display;
    }
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

    // Calculate minimap, metric strip, and main timeline heights
    // Metric strip starts collapsed, so use collapsed height for initial layout
    const minimapHeight = calculateMinimapHeight(height);
    const metricStripHeight = METRIC_STRIP_COLLAPSED_HEIGHT;
    const totalOverheadHeight = minimapHeight + MINIMAP_GAP + metricStripHeight + METRIC_STRIP_GAP;
    const mainTimelineHeight = height - totalOverheadHeight;

    // Create wrapper container with flexbox layout
    this.wrapper = document.createElement('div');
    this.wrapper.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';

    // Minimap container (fixed height)
    // Store reference for HTML label positioning
    this.minimapDiv = document.createElement('div');
    this.minimapDiv.style.cssText = `height:${minimapHeight}px;width:100%;flex-shrink:0;position:relative`;

    // Gap element between minimap and metric strip
    const minimapGapDiv = document.createElement('div');
    minimapGapDiv.style.cssText = `height:${MINIMAP_GAP}px;width:100%;flex-shrink:0;background:transparent`;

    // Metric strip container (fixed height)
    this.metricStripDiv = document.createElement('div');
    this.metricStripDiv.style.cssText = `height:${metricStripHeight}px;width:100%;flex-shrink:0;position:relative`;

    // Gap element between metric strip and main timeline
    this.metricStripGapDiv = document.createElement('div');
    this.metricStripGapDiv.style.cssText = `height:${METRIC_STRIP_GAP}px;width:100%;flex-shrink:0;background:transparent`;

    // Main timeline container (fills remaining space)
    const mainDiv = document.createElement('div');
    mainDiv.style.cssText = 'flex:1;width:100%;min-height:0';

    this.wrapper.append(
      this.minimapDiv,
      minimapGapDiv,
      this.metricStripDiv,
      this.metricStripGapDiv,
      mainDiv,
    );

    if (this.container) {
      this.container.appendChild(this.wrapper);
    }

    // Minimap app is created by MinimapOrchestrator in setupMinimap()

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
          // Notify callback that mouse left (clears tooltip)
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
        // Measurement callbacks (delegated to MeasurementOrchestrator)
        onMeasureStart: (screenX: number) => {
          this.measurementOrchestrator?.handleMeasureStart(screenX);
        },
        onMeasureUpdate: (screenX: number) => {
          this.measurementOrchestrator?.handleMeasureUpdate(screenX);
        },
        onMeasureEnd: () => {
          this.measurementOrchestrator?.handleMeasureEnd();
        },
        onMeasureCancel: () => {
          this.measurementOrchestrator?.clearMeasurement();
        },
        onAreaZoomStart: (screenX: number) => {
          this.measurementOrchestrator?.handleAreaZoomStart(screenX);
        },
        onAreaZoomUpdate: (screenX: number) => {
          this.measurementOrchestrator?.handleAreaZoomUpdate(screenX);
        },
        onAreaZoomEnd: () => {
          this.measurementOrchestrator?.handleAreaZoomEnd();
        },
        onAreaZoomCancel: () => {
          this.measurementOrchestrator?.clearAreaZoom();
        },
        onResizeStart: (screenX: number, edge: 'left' | 'right') => {
          this.measurementOrchestrator?.handleResizeStart(screenX, edge);
        },
        onResizeUpdate: (screenX: number) => {
          this.measurementOrchestrator?.handleResizeUpdate(screenX);
        },
        onResizeEnd: () => {
          this.measurementOrchestrator?.handleResizeEnd();
        },
        getMeasurementResizeEdge: (screenX: number) => {
          return this.measurementOrchestrator?.getMeasurementResizeEdge(screenX) ?? null;
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
        if (this.measurementOrchestrator?.hasMeasurement()) {
          this.measurementOrchestrator.clearMeasurement();
        } else if (this.selectionOrchestrator?.hasAnySelection()) {
          this.selectionOrchestrator.clearSelection();
        } else {
          this.clearSearch();
        }
      },
      onMarkerNav: (direction: MarkerNavDirection) => {
        return this.selectionOrchestrator?.navigateMarker(direction) ?? false;
      },
      onFrameNav: (direction: FrameNavDirection) => {
        return this.selectionOrchestrator?.navigateFrame(direction) ?? false;
      },
      onJumpToCallTree: () => {
        // Jump to call tree for selected frame or marker
        const selectedNode = this.selectionOrchestrator?.getSelectedNode();
        if (selectedNode && this.callbacks.onJumpToCallTree) {
          this.callbacks.onJumpToCallTree(selectedNode.data);
          return;
        }

        // Jump to call tree for selected marker
        const selectedMarker = this.selectionOrchestrator?.getSelectedMarker();
        if (selectedMarker && this.callbacks.onJumpToCallTreeForMarker) {
          this.callbacks.onJumpToCallTreeForMarker(selectedMarker);
        }
      },
      onFocus: () => {
        // Focus (zoom to fit) on selected frame or marker
        if (this.selectionOrchestrator?.hasSelection()) {
          this.selectionOrchestrator.focusOnSelectedFrame();
        } else if (this.selectionOrchestrator?.hasMarkerSelection()) {
          this.selectionOrchestrator.focusOnSelectedMarker();
        }
      },
      onCopy: () => {
        // Copy selected frame name
        const selectedNode = this.selectionOrchestrator?.getSelectedNode();
        if (selectedNode && this.callbacks.onCopy) {
          this.callbacks.onCopy(selectedNode.data);
          return;
        }

        // Copy selected marker summary
        const selectedMarker = this.selectionOrchestrator?.getSelectedMarker();
        if (selectedMarker && this.callbacks.onCopyMarker) {
          this.callbacks.onCopyMarker(selectedMarker);
        }
      },

      // Minimap keyboard callbacks (delegated to MinimapOrchestrator)
      isInMinimapArea: () => this.minimapOrchestrator?.isMouseInMinimapArea() ?? false,
      onMinimapPanViewport: (delta) => this.handleAnimatedPanViewport(delta),
      onMinimapPanDepth: (delta) => this.handleAnimatedPanDepth(delta),
      onMinimapZoom: (dir) => this.handleAnimatedZoom(dir),
      onMinimapJumpStart: () => this.minimapOrchestrator?.handleJumpStart(),
      onMinimapJumpEnd: () => this.minimapOrchestrator?.handleJumpEnd(),
      onMinimapResetZoom: () => this.resetZoom(),

      // Metric strip keyboard callbacks (delegated to viewport via animation)
      isInMetricStripArea: () => this.metricStripOrchestrator?.isMouseInMetricStripArea() ?? false,
      onMetricStripPanViewport: (delta) => this.handleAnimatedPanViewport(delta),
      onMetricStripPanDepth: (delta) => this.handleAnimatedPanDepth(delta),
      onMetricStripZoom: (dir) => this.handleAnimatedZoom(dir),
      onMetricStripJumpStart: () => {
        if (!this.viewport) {
          return;
        }
        this.viewportAnimator?.cancel();
        const viewportState = this.viewport.getState();
        this.viewport.setOffset(0, viewportState.offsetY);
        this.notifyViewportChange();
      },
      onMetricStripJumpEnd: () => {
        if (!this.viewport || !this.index) {
          return;
        }
        this.viewportAnimator?.cancel();
        const viewportState = this.viewport.getState();
        const endOffsetX =
          this.index.totalDuration * viewportState.zoom - viewportState.displayWidth;
        this.viewport.setOffset(Math.max(0, endOffsetX), viewportState.offsetY);
        this.notifyViewportChange();
      },
      onMetricStripResetZoom: () => this.resetZoom(),
    });

    this.keyboardHandler.attach();
  }

  /**
   * Setup minimap orchestrator for Chrome DevTools-style overview navigation.
   */
  private async setupMinimap(): Promise<void> {
    if (!this.index || !this.rectangleManager || !this.viewport || !this.minimapDiv) {
      return;
    }

    const containerHeight = this.container?.getBoundingClientRect().height ?? 0;
    const { displayWidth } = this.viewport.getState();

    // Create minimap orchestrator with callbacks
    this.minimapOrchestrator = new MinimapOrchestrator({
      onViewportChange: (zoom: number, offsetX: number) => {
        if (!this.viewport) {
          return;
        }
        const viewportState = this.viewport.getState();
        this.viewport.setZoom(zoom);
        this.viewport.setOffset(offsetX, viewportState.offsetY);
        this.notifyViewportChange();
      },
      onZoom: (factor: number, anchorTimeNs: number) => {
        if (!this.viewport) {
          return;
        }
        // Convert anchor time to screen X in main viewport
        const viewportState = this.viewport.getState();
        const anchorScreenX = anchorTimeNs * viewportState.zoom - viewportState.offsetX;
        // Apply zoom with anchor
        this.viewport.zoomByFactor(factor, anchorScreenX);
        this.notifyViewportChange();
      },
      onDepthPan: (deltaY: number) => {
        if (!this.viewport) {
          return;
        }
        const viewportState = this.viewport.getState();
        const newOffsetY = viewportState.offsetY + deltaY;
        this.viewport.setOffset(viewportState.offsetX, newOffsetY);
        this.notifyViewportChange();
      },
      onCursorMove: (_timeNs: number | null) => {
        // Cursor is now managed by the orchestrator
        // The orchestrator updates its internal cursorTimeNs state
      },
      requestRender: () => {
        this.requestRender();
      },
      requestCursorRender: () => {
        this.requestCursorRender();
      },
      onResetZoom: () => {
        this.resetZoom();
      },
    });

    // Initialize the orchestrator
    await this.minimapOrchestrator.init(
      this.minimapDiv,
      displayWidth,
      containerHeight,
      this.index,
      this.rectangleManager,
      this.viewport,
    );

    // Focus container on minimap mousedown for keyboard support
    const minimapApp = this.minimapOrchestrator.getApp();
    if (minimapApp?.canvas) {
      minimapApp.canvas.addEventListener('mousedown', () => {
        this.container?.focus();
      });
    }
  }

  /**
   * Setup metric strip orchestrator for governor limit visualization.
   */
  private async setupMetricStrip(): Promise<void> {
    if (!this.index || !this.viewport || !this.metricStripDiv) {
      return;
    }

    const { displayWidth } = this.viewport.getState();

    // Create metric strip orchestrator with callbacks
    this.metricStripOrchestrator = new MetricStripOrchestrator({
      onZoomToRegion: (centerTimeNs: number, durationNs: number) => {
        if (!this.viewport) {
          return;
        }
        // Simplified zoom calculation for better performance
        // Calculate new zoom to fit the duration in the viewport
        const viewportState = this.viewport.getState();
        const newZoom = viewportState.displayWidth / durationNs;
        // Center on the click time
        const newOffsetX = centerTimeNs * newZoom - viewportState.displayWidth / 2;

        this.viewport.setZoom(newZoom);
        this.viewport.setOffset(Math.max(0, newOffsetX), viewportState.offsetY);
        this.notifyViewportChange();
      },
      onCursorMove: (timeNs: number | null) => {
        // Update minimap cursor to sync with metric strip
        this.minimapOrchestrator?.setCursorFromMainTimeline(timeNs);
      },
      requestRender: () => {
        this.requestRender();
      },
      requestCursorRender: () => {
        this.requestCursorRender();
      },
      onZoom: (factor: number, anchorTimeNs: number) => {
        if (!this.viewport) {
          return;
        }
        // Convert anchor time to screen X in main viewport
        const viewportState = this.viewport.getState();
        const anchorScreenX = anchorTimeNs * viewportState.zoom - viewportState.offsetX;
        // Apply zoom with anchor
        this.viewport.zoomByFactor(factor, anchorScreenX);
        this.notifyViewportChange();
      },
      onHorizontalPan: (deltaPixels: number) => {
        if (!this.viewport) {
          return;
        }
        const viewportState = this.viewport.getState();
        this.viewport.setOffset(viewportState.offsetX + deltaPixels, viewportState.offsetY);
        this.notifyViewportChange();
      },
      onResetView: () => {
        this.resetZoom();
      },
      onDepthPan: (deltaY: number) => {
        if (!this.viewport) {
          return;
        }
        const viewportState = this.viewport.getState();
        this.viewport.setOffset(viewportState.offsetX, viewportState.offsetY + deltaY);
        this.notifyViewportChange();
      },
      onHeightChange: (newHeight: number) => {
        // Update metric strip div height
        if (this.metricStripDiv) {
          this.metricStripDiv.style.height = `${newHeight}px`;
        }
        // Trigger full layout recalculation to resize main timeline
        // The container size doesn't change, but internal flexbox layout does
        if (this.container) {
          const { width, height } = this.container.getBoundingClientRect();
          this.resize(width, height);
        }
      },
    });

    // Initialize the orchestrator
    await this.metricStripOrchestrator.init(
      this.metricStripDiv,
      displayWidth,
      this.index.totalDuration,
    );

    // Focus container on metric strip mousedown for keyboard support
    const metricStripApp = this.metricStripOrchestrator.getApp();
    if (metricStripApp?.canvas) {
      metricStripApp.canvas.addEventListener('mousedown', () => {
        this.container?.focus();
      });
    }
  }

  /**
   * Setup selection orchestrator for frame and marker selection.
   */
  private setupSelection(treeNodes: TreeNode<E>[], maps: NavigationMaps): void {
    if (!this.worldContainer || !this.viewport || !this.index) {
      return;
    }

    // Create selection orchestrator with callbacks
    this.selectionOrchestrator = new SelectionOrchestrator<E>({
      onSelectionChange: (event: EventNode | null) => {
        this.callbacks.onSelect?.(event);
      },
      onMarkerSelectionChange: (marker: TimelineMarker | null) => {
        this.callbacks.onMarkerSelect?.(marker);
      },
      onCenterOnFrame: (timestamp: number, duration: number, depth: number) => {
        if (!this.viewport) {
          return null;
        }
        return this.viewport.calculateCenterOffset(timestamp, duration, depth);
      },
      onCenterOnMarker: (startTime: number, duration: number, depth: number) => {
        if (!this.viewport) {
          return null;
        }
        return this.viewport.calculateCenterOffset(startTime, duration, depth);
      },
      onFocusOnFrame: (timestamp: number, duration: number, depth: number) => {
        if (!this.viewport) {
          return;
        }
        this.viewport.focusOnEvent(timestamp, duration, depth);
        this.notifyViewportChange();
      },
      onFocusOnMarker: (startTime: number, duration: number, depth: number) => {
        if (!this.viewport) {
          return;
        }
        this.viewport.focusOnEvent(startTime, duration, depth);
        this.notifyViewportChange();
      },
      onFrameNavigate: (event: EventNode, screenX: number, screenY: number, depth: number) => {
        this.callbacks.onFrameNavigate?.(event, screenX, screenY, depth);
      },
      onMarkerNavigate: (marker: TimelineMarker, screenX: number, screenY: number) => {
        this.callbacks.onMarkerNavigate?.(marker, screenX, screenY);
      },
      onAnimateToPosition: (targetX: number, targetY: number, durationMs: number) => {
        if (!this.viewport || !this.viewportAnimator) {
          return;
        }
        this.viewportAnimator.animate(this.viewport, targetX, targetY, durationMs, () =>
          this.notifyViewportChange(),
        );
      },
      requestRender: () => {
        // Selection change only needs highlights + overlays (Phase 3 optimization)
        this.requestHighlightsRender();
      },
    });

    // Initialize the orchestrator
    this.selectionOrchestrator.init(
      this.worldContainer,
      this.viewport,
      treeNodes,
      maps,
      this.markers,
      this.index.totalDuration,
      this.index.maxDepth,
      this.mainTimelineYOffset,
    );
  }

  /**
   * Setup measurement orchestrator for Shift+drag measurement and Alt+drag area zoom.
   */
  private setupMeasurement(): void {
    if (!this.worldContainer || !this.container || !this.viewport || !this.index) {
      return;
    }

    // Create measurement orchestrator with callbacks
    this.measurementOrchestrator = new MeasurementOrchestrator({
      onZoomToRange: (startTime: number, duration: number, middleDepth: number) => {
        if (!this.viewport) {
          return;
        }
        // Focus on the range (zoom to fit exactly, no padding)
        this.viewport.focusOnEvent(startTime, duration, middleDepth, 0);
        this.notifyViewportChange();
      },
      onMeasurementChange: (measurement: MeasurementState | null) => {
        this.callbacks.onMeasurementChange?.(measurement);
      },
      requestRender: () => {
        this.requestRender();
      },
      onClearSearch: () => {
        this.clearSearch();
      },
    });

    // Initialize the orchestrator
    this.measurementOrchestrator.init(
      this.worldContainer,
      this.container,
      this.viewport,
      this.index.totalDuration,
      this.index.maxDepth,
    );
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

    // Update cursor style based on hit test
    if (this.interactionHandler) {
      this.interactionHandler.updateCursor(event !== null || marker !== null);
    }

    // No cursor line when hovering main timeline
    // Cursor line only shows when hovering minimap or metric strip (bidirectional mirroring)

    // Notify callback with container-relative coordinates
    // (screenY is canvas-relative, add minimap offset for container-relative positioning)
    if (this.callbacks.onMouseMove) {
      this.callbacks.onMouseMove(screenX, screenY + this.mainTimelineYOffset, event, marker);
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
      const treeNode = this.selectionOrchestrator?.findByOriginal(event);
      if (treeNode) {
        this.selectionOrchestrator?.selectFrame(treeNode);
      }
    } else if (marker) {
      // Clicked on a marker - select it
      this.selectionOrchestrator?.selectMarker(marker);
    } else {
      // Clicked on empty space - check if inside measurement area
      if (this.measurementOrchestrator?.hasMeasurement()) {
        if (!this.measurementOrchestrator.isInsideMeasurement(screenX)) {
          // Clicked outside measurement - clear it
          this.measurementOrchestrator.clearMeasurement();
          return;
        }
        // Clicked inside measurement - don't clear, allow frame selection below
      }
      this.selectionOrchestrator?.clearSelection();
    }

    // Notify callback with container-relative coordinates
    if (this.callbacks.onClick) {
      this.callbacks.onClick(screenX, screenY + this.mainTimelineYOffset, event, marker, modifiers);
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
    if (this.measurementOrchestrator?.hasMeasurement()) {
      if (this.measurementOrchestrator.isInsideMeasurement(screenX)) {
        // Zoom to measurement range
        this.measurementOrchestrator.zoomToMeasurement();
        return;
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
      const treeNode = this.selectionOrchestrator?.findByOriginal(event);
      if (!treeNode) {
        return;
      }

      // Select the frame first (so it's highlighted after focus)
      this.selectionOrchestrator?.selectFrame(treeNode);

      // Focus on the individual event (zoom to fit)
      this.selectionOrchestrator?.focusOnSelectedFrame();
      return;
    }

    // Handle marker double-click
    if (marker) {
      // Select the marker first (so it's highlighted after focus)
      this.selectionOrchestrator?.selectMarker(marker);

      // Focus on the marker (zoom to fit)
      this.selectionOrchestrator?.focusOnSelectedMarker();
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
      const treeNode = this.selectionOrchestrator?.findByOriginal(event);
      if (!treeNode) {
        return;
      }

      // Select the frame (so it's highlighted when menu appears)
      this.selectionOrchestrator?.selectFrame(treeNode);

      // Notify callback with selected event data
      // - screenX/screenY: container-relative coordinates for tooltip positioning
      // - clientX/clientY: window coordinates for context menu positioning
      if (this.callbacks.onContextMenu) {
        this.callbacks.onContextMenu(
          treeNode.data,
          screenX,
          screenY + this.mainTimelineYOffset,
          clientX,
          clientY,
        );
      }
      return;
    }

    // Handle marker context menu
    if (marker) {
      // Select the marker (so it's highlighted when menu appears)
      this.selectionOrchestrator?.selectMarker(marker);

      // Notify callback with selected marker data
      if (this.callbacks.onContextMenu) {
        this.callbacks.onContextMenu(
          marker,
          screenX,
          screenY + this.mainTimelineYOffset,
          clientX,
          clientY,
        );
      }
      return;
    }

    // Empty space click - notify callback with null
    if (this.callbacks.onContextMenu) {
      this.callbacks.onContextMenu(
        null,
        screenX,
        screenY + this.mainTimelineYOffset,
        clientX,
        clientY,
      );
    }
  }

  // ============================================================================
  // MEASUREMENT HANDLERS
  // ============================================================================

  // ============================================================================
  // MEASUREMENT API (delegated to MeasurementOrchestrator)
  // ============================================================================

  /**
   * Clear the current measurement.
   * Called when user presses Escape, clicks elsewhere, or starts a new selection.
   */
  public clearMeasurement(): void {
    this.measurementOrchestrator?.clearMeasurement();
  }

  /**
   * Check if there is an active measurement.
   */
  public hasMeasurement(): boolean {
    return this.measurementOrchestrator?.hasMeasurement() ?? false;
  }

  /**
   * Zoom to fit the current measurement range.
   * Used by double-click inside measurement and zoom icon in label.
   */
  public zoomToMeasurement(): void {
    this.measurementOrchestrator?.zoomToMeasurement();
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
    if (this.selectionOrchestrator?.hasAnySelection()) {
      return 'selection';
    }
    if (this.searchOrchestrator?.isActive()) {
      return 'search';
    }
    return 'none';
  }

  /**
   * Notify viewport change and request render.
   * Consolidates duplicated callback pattern.
   */
  private notifyViewportChange(): void {
    // requestRender() now defaults to full render (invalidateAll)
    this.requestRender();
    if (this.callbacks.onViewportChange && this.viewport) {
      this.callbacks.onViewportChange(this.viewport.getState());
    }
  }

  // ============================================================================
  // RENDER INVALIDATION (Phase 3 optimization)
  // ============================================================================

  /**
   * Invalidate all render phases (full render needed).
   * Used when viewport changes (zoom, pan).
   */
  private invalidateAll(): void {
    if (!this.state) {
      return;
    }
    this.state.renderDirty = {
      background: true,
      culling: true,
      eventRendering: true,
      highlights: true,
      overlays: true,
      minimap: true,
      metricStrip: true,
    };
  }

  /**
   * Invalidate highlights and overlays (for selection change).
   * Skips expensive culling but re-renders highlights.
   */
  private invalidateHighlights(): void {
    if (!this.state) {
      return;
    }
    this.state.renderDirty.highlights = true;
    this.state.renderDirty.overlays = true;
    this.state.renderDirty.minimap = true;
    this.state.renderDirty.metricStrip = true;
  }

  // ============================================================================
  // SELECTION API (delegated to SelectionOrchestrator)
  // ============================================================================

  /**
   * Focus viewport on the currently selected frame (zoom to fit).
   * Calculates optimal zoom to fit the frame with padding.
   */
  public focusOnSelectedFrame(): void {
    this.selectionOrchestrator?.focusOnSelectedFrame();
  }

  /**
   * Focus viewport on the currently selected marker (zoom to fit).
   * Calculates optimal zoom to fit the marker with padding.
   */
  public focusOnSelectedMarker(): void {
    this.selectionOrchestrator?.focusOnSelectedMarker();
  }

  /**
   * Get the currently selected node (frame).
   *
   * @returns Currently selected TreeNode, or null if none
   */
  public getSelectedNode(): TreeNode<E> | null {
    return this.selectionOrchestrator?.getSelectedNode() ?? null;
  }

  /**
   * Get the currently selected marker.
   *
   * @returns Currently selected TimelineMarker, or null if none
   */
  public getSelectedMarker(): TimelineMarker | null {
    return this.selectionOrchestrator?.getSelectedMarker() ?? null;
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

  /**
   * Handle animated pan in the time (X) direction.
   * Used by minimap and metric strip keyboard handlers.
   */
  private handleAnimatedPanViewport(deltaTimeNs: number): void {
    if (!this.viewport || !this.viewportAnimator) {
      return;
    }
    const viewportState = this.viewport.getState();
    const deltaX = deltaTimeNs * viewportState.zoom;
    this.viewportAnimator.addToTarget(this.viewport, deltaX, 0, () => this.notifyViewportChange());
  }

  /**
   * Handle animated pan in the depth (Y) direction.
   * Used by minimap and metric strip keyboard handlers.
   */
  private handleAnimatedPanDepth(deltaY: number): void {
    if (!this.viewport || !this.viewportAnimator) {
      return;
    }
    this.viewportAnimator.addToTarget(this.viewport, 0, deltaY, () => this.notifyViewportChange());
  }

  /**
   * Handle animated zoom in or out.
   * Used by minimap and metric strip keyboard handlers.
   */
  private handleAnimatedZoom(direction: 'in' | 'out'): void {
    if (!this.viewport || !this.viewportAnimator) {
      return;
    }
    const factor =
      direction === 'in' ? KEYBOARD_CONSTANTS.zoomFactor : 1 / KEYBOARD_CONSTANTS.zoomFactor;
    this.viewportAnimator.multiplyZoomTarget(this.viewport, factor, () =>
      this.notifyViewportChange(),
    );
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
      renderDirty: {
        background: true,
        culling: true,
        eventRendering: true,
        highlights: true,
        overlays: true,
        minimap: true,
        metricStrip: true,
      },
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

  /**
   * Main render loop - coordinates all rendering phases with dirty flag optimization.
   *
   * Phase 3 optimization: Skip expensive phases when only cursor/overlay changed.
   * - Mouse move: ~1ms (overlays only) vs ~10ms (full render)
   * - Selection change: ~2ms (highlights + overlays) vs ~10ms
   * - Viewport change: ~10ms (all phases - unchanged)
   */
  private render(): void {
    if (!this.canRender()) {
      return;
    }

    const viewportState = this.viewport!.getState();
    this.state!.viewport = viewportState;
    const dirty = this.state!.renderDirty;

    // Phase 1: Position containers and render background layers
    if (dirty.background) {
      this.renderBackground(viewportState);
      dirty.background = false;
    }

    // Phase 2: Cull visible rectangles and update hit testing
    // This is the most expensive phase - cache results when viewport unchanged
    let visibleRects: Map<string, import('./RectangleManager.js').PrecomputedRect[]>;
    let buckets: Map<string, import('../types/flamechart.types.js').PixelBucket[]>;

    if (dirty.culling || !this.cachedVisibleRects || !this.cachedBuckets) {
      const culled = this.rectangleManager!.getCulledRectangles(
        viewportState,
        this.state!.batchColorsCache,
      );
      visibleRects = culled.visibleRects;
      buckets = culled.buckets;

      // Cache for reuse when only cursor moves
      this.cachedVisibleRects = visibleRects;
      this.cachedBuckets = buckets;

      this.hitTestManager?.setVisibleRects(visibleRects);
      this.hitTestManager?.setBuckets(buckets);
      dirty.culling = false;
    } else {
      // Reuse cached culling results
      visibleRects = this.cachedVisibleRects;
      buckets = this.cachedBuckets;
    }

    // Phase 3: Render events and labels (search mode vs normal mode)
    if (dirty.eventRendering) {
      const searchContext = { viewportState, visibleRects, buckets };
      this.renderEventsAndLabels(viewportState, visibleRects, buckets, searchContext);
      dirty.eventRendering = false;
    }

    // Phase 4: Render highlights (selection or search, mutually exclusive)
    if (dirty.highlights) {
      this.renderHighlights(viewportState);
      dirty.highlights = false;
    }

    // Phase 5: Render overlays (measurement, cursor line)
    if (dirty.overlays) {
      this.renderOverlays(viewportState);
      dirty.overlays = false;
    }

    // Phase 6: Render main timeline canvas (always needed after any changes)
    this.app!.render();

    // Phase 7: Render minimap
    if (dirty.minimap) {
      this.renderMinimap(viewportState);
      dirty.minimap = false;
    }

    // Phase 8: Render metric strip
    if (dirty.metricStrip) {
      this.renderMetricStrip(viewportState);
      dirty.metricStrip = false;
    }
  }

  /**
   * Check if render prerequisites are met.
   */
  private canRender(): boolean {
    return !!(
      this.rectangleManager &&
      this.batchRenderer &&
      this.state &&
      this.viewport &&
      this.app &&
      this.worldContainer
    );
  }

  /**
   * Position containers and render background layers (markers, axis).
   */
  private renderBackground(viewportState: ViewportState): void {
    const { offsetX } = viewportState;
    const screenHeight = this.app!.screen.height;

    // Position containers (main timeline has its own canvas - position at bottom)
    this.markerContainer?.position.set(-offsetX, screenHeight);
    this.axisContainer?.position.set(-offsetX, screenHeight);
    this.worldContainer!.position.set(-offsetX, screenHeight - viewportState.offsetY);

    // Render background layers
    this.markerRenderer?.render();
    this.axisRenderer?.render(viewportState);
  }

  /**
   * Render events and labels with appropriate styling (search mode vs normal mode).
   */
  private renderEventsAndLabels(
    viewportState: ViewportState,
    visibleRects: Map<string, import('./RectangleManager.js').PrecomputedRect[]>,
    buckets: Map<string, import('../types/flamechart.types.js').PixelBucket[]>,
    searchContext: {
      viewportState: ViewportState;
      visibleRects: typeof visibleRects;
      buckets: typeof buckets;
    },
  ): void {
    const hasActiveSearch = this.searchOrchestrator?.hasCursor() ?? false;

    if (hasActiveSearch) {
      // Search mode: render with desaturation
      this.searchOrchestrator!.renderStyledEvents(searchContext);
      this.searchOrchestrator!.renderStyledLabels(searchContext);
      this.batchRenderer?.clear();
    } else {
      // Normal mode: render with original colors
      this.batchRenderer!.render(visibleRects, buckets, viewportState);
      this.textLabelRenderer?.render(visibleRects, viewportState);
      this.searchOrchestrator?.clearStyledEvents();
      this.searchOrchestrator?.clearStyledLabels();
    }
  }

  /**
   * Render highlights (selection or search, mutually exclusive).
   */
  private renderHighlights(viewportState: ViewportState): void {
    const highlightMode = this.getHighlightMode();

    if (highlightMode === 'selection') {
      this.selectionOrchestrator?.render({ viewportState });
      this.searchOrchestrator?.clearHighlight();
    } else if (highlightMode === 'search') {
      this.searchOrchestrator?.renderHighlight(viewportState);
      this.selectionOrchestrator?.clearRender();
    } else {
      this.searchOrchestrator?.clearHighlight();
      this.selectionOrchestrator?.clearRender();
    }
  }

  /**
   * Render overlays (measurement, cursor line).
   */
  private renderOverlays(viewportState: ViewportState): void {
    // Measurement and area zoom overlays
    this.measurementOrchestrator?.render({ viewportState });

    // Cursor line (bidirectional cursor mirroring)
    // Only shows when hovering minimap or metric strip, not main timeline
    if (this.cursorLineRenderer && this.minimapOrchestrator) {
      const cursorTimeNs = this.minimapOrchestrator.getCursorTimeNs();
      this.cursorLineRenderer.render(viewportState, cursorTimeNs);
    }
  }

  /**
   * Render minimap via orchestrator.
   */
  private renderMinimap(viewportState: ViewportState): void {
    if (!this.minimapOrchestrator || !this.viewport || !this.state) {
      return;
    }

    const bounds = this.viewport.getBounds();
    this.minimapOrchestrator.render({
      viewportState,
      viewportBounds: {
        depthStart: bounds.depthStart,
        depthEnd: bounds.depthEnd,
      },
      markers: this.markers,
      batchColors: this.state.batchColorsCache,
      cursorTimeNs: this.minimapOrchestrator.getCursorTimeNs(),
    });
  }

  /**
   * Render metric strip via orchestrator.
   * Pure render method - click handling and cursor updates happen in event handlers.
   */
  private renderMetricStrip(viewportState: ViewportState): void {
    if (!this.metricStripOrchestrator || !this.index) {
      return;
    }

    // Get cursor time from metric strip or minimap (for bidirectional sync)
    const cursorTimeNs = this.metricStripOrchestrator.isMouseInMetricStripArea()
      ? this.metricStripOrchestrator.getCursorTimeNs()
      : (this.minimapOrchestrator?.getCursorTimeNs() ?? null);

    this.metricStripOrchestrator.render({
      viewportState,
      totalDuration: this.index.totalDuration,
      cursorTimeNs,
      markers: this.markers,
    });
  }
}
