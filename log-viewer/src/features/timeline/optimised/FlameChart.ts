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
import type { PrecomputedRect } from './RectangleManager.js';
import { RectangleManager } from './RectangleManager.js';
import { FlameChartCursor } from './search/FlameChartCursor.js';
import { SearchManager } from './search/SearchManager.js';
import { SelectionHighlightRenderer } from './selection/SelectionHighlightRenderer.js';
import { SelectionManager } from './selection/SelectionManager.js';
import { TimelineEventIndex } from './TimelineEventIndex.js';
import { TimelineViewport } from './TimelineViewport.js';
import { ViewportAnimator } from './ViewportAnimator.js';

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

    // For mesh renderers, move meshes to stage root for clip-space rendering
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
    }

    // Create hit test manager for mouse interactions
    this.hitTestManager = new HitTestManager({
      index: this.index,
      visibleRects: new Map(),
      buckets: new Map(),
      markerRenderer: this.markerRenderer,
    });

    // Create selection highlight renderer
    if (this.worldContainer) {
      this.selectionRenderer = new SelectionHighlightRenderer(this.worldContainer);
      // Set marker context for marker selection highlighting
      this.selectionRenderer.setMarkerContext(
        this.markers,
        this.index.totalDuration,
        this.index.maxDepth,
      );
    }

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
        onDoubleClick: (x: number, y: number) => {
          this.handleDoubleClick(x, y);
        },
        onMouseLeave: () => {
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
        // Clear selection first (frame or marker), then search
        if (this.selectionManager?.hasAnySelection()) {
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
      onShiftHeld: (_held: boolean) => {
        // Phase 1: No-op - hints overlay is a bonus feature
        // Can be implemented later with ShortcutHintsOverlay component
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
    });

    this.keyboardHandler.attach();
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

  private handleClick(screenX: number, screenY: number): void {
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
      // Clicked on empty space - clear selection
      this.clearSelection();
    }

    // Notify callback
    if (this.callbacks.onClick) {
      this.callbacks.onClick(screenX, screenY, event, marker);
    }
  }

  /**
   * Handle double-click - focus (zoom to fit) on the clicked event or marker.
   * When clicking on a bucket, focuses on the same "best event" that the tooltip displays.
   */
  private handleDoubleClick(screenX: number, screenY: number): void {
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
    this.selectionManager?.select(node);

    // Update selection renderer
    if (this.selectionRenderer) {
      this.selectionRenderer.setSelection(node as TreeNode<EventNode>);
    }

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
    this.selectionManager?.selectMarker(marker);

    // Update selection renderer
    if (this.selectionRenderer) {
      this.selectionRenderer.setMarkerSelection(marker);
    }

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

    // If navigation found a valid marker, update renderer and center viewport
    if (nextMarker) {
      // Update selection renderer
      if (this.selectionRenderer) {
        this.selectionRenderer.setMarkerSelection(nextMarker);
      }

      // Notify callback
      if (this.callbacks.onMarkerSelect) {
        this.callbacks.onMarkerSelect(nextMarker);
      }

      // Always request render to show updated selection highlight
      this.requestRender();

      // Auto-center viewport on the newly selected marker
      this.centerOnSelectedMarker();
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

    // If navigation found a valid node, update renderer and center viewport
    if (nextNode) {
      // Update selection renderer
      if (this.selectionRenderer) {
        this.selectionRenderer.setSelection(nextNode as TreeNode<EventNode>);
      }

      // Notify callback
      if (this.callbacks.onSelect) {
        this.callbacks.onSelect(nextNode.data);
      }

      // Always request render to show updated selection highlight
      // (centerOnSelectedFrame only renders if viewport moves)
      this.requestRender();

      // Auto-center viewport on the newly selected frame
      this.centerOnSelectedFrame();
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
      this.selectionRenderer?.render(viewportState);
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

    this.app.render();
  }
}
