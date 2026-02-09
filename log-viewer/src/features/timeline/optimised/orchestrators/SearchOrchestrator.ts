/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * SearchOrchestrator
 *
 * Orchestrates search functionality (find, navigate matches, styled rendering).
 * Owns search state and all search-related renderers.
 *
 * Responsibilities:
 * - Search execution and cursor management
 * - Search navigation with viewport centering
 * - Styled rendering (desaturation for non-matches)
 * - Current match highlight rendering
 *
 * Communication pattern:
 * - Uses callbacks to notify FlameChart of navigation and render requests
 * - Receives ViewportState as read-only input
 * - Never mutates viewport directly
 *
 * Render coordination:
 * - When search is active, FlameChart calls renderStyledEvents() instead of batchRenderer
 * - When search is active, FlameChart calls renderStyledLabels() instead of textLabelRenderer
 * - renderHighlight() renders the current match highlight
 */

import * as PIXI from 'pixi.js';
import type {
  EventNode,
  PixelBucket,
  RenderBatch,
  TreeNode,
  ViewportState,
} from '../../types/flamechart.types.js';
import type { SearchCursor, SearchOptions } from '../../types/search.types.js';
import type { PrecomputedRect, RectangleManager } from '../RectangleManager.js';
import { FlameChartCursor } from '../search/FlameChartCursor.js';
import { MeshSearchStyleRenderer } from '../search/MeshSearchStyleRenderer.js';
import { SearchCursorImpl } from '../search/SearchCursor.js';
import { SearchHighlightRenderer } from '../search/SearchHighlightRenderer.js';
import { SearchManager } from '../search/SearchManager.js';
import { SearchStyleRenderer } from '../search/SearchStyleRenderer.js';
import { SearchTextLabelRenderer } from '../search/SearchTextLabelRenderer.js';
import type { TextLabelRenderer } from '../TextLabelRenderer.js';
import type { TimelineViewport } from '../TimelineViewport.js';

/**
 * Callbacks for search orchestrator events.
 */
export interface SearchOrchestratorCallbacks {
  /**
   * Called when search navigation moves to a match.
   * Includes screen coordinates for tooltip positioning.
   *
   * @param event - Matched event data
   * @param screenX - Screen X coordinate (container-relative)
   * @param screenY - Screen Y coordinate (container-relative)
   * @param depth - Event depth
   */
  onSearchNavigate: (event: EventNode, screenX: number, screenY: number, depth: number) => void;

  /**
   * Called when viewport should center on a match.
   *
   * @param timestamp - Match start time in nanoseconds
   * @param duration - Match duration in nanoseconds
   * @param depth - Match depth in tree
   */
  onCenterOnMatch: (timestamp: number, duration: number, depth: number) => void;

  /**
   * Called when selection should be cleared.
   * Search and selection highlights are mutually exclusive.
   */
  onClearSelection: () => void;

  /**
   * Called when a re-render is needed.
   */
  requestRender: () => void;
}

/**
 * Context for rendering search overlays.
 */
export interface SearchRenderContext {
  /** Current viewport state */
  viewportState: ViewportState;
  /** Visible rectangles from culling */
  visibleRects: Map<string, PrecomputedRect[]>;
  /** Bucket rectangles from culling */
  buckets: Map<string, PixelBucket[]>;
}

export class SearchOrchestrator<E extends EventNode = EventNode> {
  // ============================================================================
  // SEARCH COMPONENTS
  // ============================================================================
  private searchManager: SearchManager<E> | null = null;
  private searchStyleRenderer: SearchStyleRenderer | MeshSearchStyleRenderer | null = null;
  private searchHighlightRenderer: SearchHighlightRenderer | null = null;
  private searchTextLabelRenderer: SearchTextLabelRenderer | null = null;

  // ============================================================================
  // DEFERRED INIT STATE
  // ============================================================================
  /** Stored for deferred renderer initialization */
  private deferredInitData: {
    worldContainer: PIXI.Container;
    batches: Map<string, RenderBatch>;
    textLabelRenderer: TextLabelRenderer;
    useMeshRenderer: boolean;
    stage?: PIXI.Container;
  } | null = null;

  // ============================================================================
  // EXTERNAL REFERENCES (not owned)
  // ============================================================================
  private viewport: TimelineViewport | null = null;
  private mainTimelineYOffset: number = 0;

  private callbacks: SearchOrchestratorCallbacks;

  constructor(callbacks: SearchOrchestratorCallbacks) {
    this.callbacks = callbacks;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Initialize the search system.
   *
   * @param worldContainer - PixiJS container for renderers
   * @param treeNodes - Pre-converted TreeNode structure for search
   * @param rectangleManager - Rectangle manager for building rect map
   * @param batches - Event batches for styled rendering
   * @param textLabelRenderer - Text label renderer for search label coordination
   * @param useMeshRenderer - Whether to use mesh-based renderers
   * @param viewport - Main timeline viewport (for coordinate calculations)
   * @param mainTimelineYOffset - Offset from container top to main timeline canvas
   */
  public init(
    worldContainer: PIXI.Container,
    treeNodes: TreeNode<E>[],
    rectangleManager: RectangleManager,
    batches: Map<string, RenderBatch>,
    textLabelRenderer: TextLabelRenderer,
    useMeshRenderer: boolean,
    viewport: TimelineViewport,
    mainTimelineYOffset: number,
  ): void {
    this.viewport = viewport;
    this.mainTimelineYOffset = mainTimelineYOffset;

    // PERF: Use cached rectMapById instead of rebuilding (~18ms saved)
    const rectMap = rectangleManager.getRectMapById();

    // Initialize SearchManager eagerly (needed for search() calls)
    this.searchManager = new SearchManager(treeNodes, rectMap);

    // PERF: Defer renderer initialization to first search() call (~6ms saved at init)
    // Store data needed for deferred initialization
    this.deferredInitData = {
      worldContainer,
      batches,
      textLabelRenderer,
      useMeshRenderer,
    };
  }

  /**
   * Ensure search renderers are initialized (lazy initialization).
   * Called on first search() or render operation.
   */
  private ensureRenderersInitialized(): void {
    if (this.searchStyleRenderer || !this.deferredInitData) {
      return; // Already initialized or no data to initialize with
    }

    const { worldContainer, batches, textLabelRenderer, useMeshRenderer, stage } =
      this.deferredInitData;

    // Initialize search style renderer (renders with desaturation for search mode)
    if (useMeshRenderer) {
      this.searchStyleRenderer = new MeshSearchStyleRenderer(worldContainer, batches);
      // If stage was set before renderers were initialized, apply it now
      if (stage) {
        (this.searchStyleRenderer as MeshSearchStyleRenderer).setStageContainer(stage);
      }
    } else {
      this.searchStyleRenderer = new SearchStyleRenderer(worldContainer, batches);
    }

    // Initialize search highlight renderer (for borders/overlays on current match)
    this.searchHighlightRenderer = new SearchHighlightRenderer(worldContainer);

    // Initialize search text label renderer (coordinates matched and unmatched labels)
    this.searchTextLabelRenderer = new SearchTextLabelRenderer(
      worldContainer,
      textLabelRenderer,
      batches,
    );

    // Clear deferred data - no longer needed
    this.deferredInitData = null;
  }

  /**
   * Set stage container for mesh-based renderers (clip-space rendering).
   *
   * @param stage - PixiJS stage container
   */
  public setStageContainer(stage: PIXI.Container): void {
    // Store for deferred initialization if renderers not yet created
    if (this.deferredInitData) {
      this.deferredInitData.stage = stage;
    }

    // Apply immediately if renderer already exists
    if (this.searchStyleRenderer && 'setStageContainer' in this.searchStyleRenderer) {
      (this.searchStyleRenderer as MeshSearchStyleRenderer).setStageContainer(stage);
    }
  }

  /**
   * Update the mainTimelineYOffset (e.g., after resize).
   *
   * @param offset - New offset value
   */
  public setMainTimelineYOffset(offset: number): void {
    this.mainTimelineYOffset = offset;
  }

  /**
   * Clean up all search resources.
   */
  public destroy(): void {
    if (this.searchHighlightRenderer) {
      this.searchHighlightRenderer.destroy();
      this.searchHighlightRenderer = null;
    }

    if (this.searchStyleRenderer) {
      this.searchStyleRenderer.destroy();
      this.searchStyleRenderer = null;
    }

    if (this.searchTextLabelRenderer) {
      this.searchTextLabelRenderer.destroy();
      this.searchTextLabelRenderer = null;
    }

    this.searchManager = null;
    this.viewport = null;
  }

  // ============================================================================
  // PUBLIC API - SEARCH
  // ============================================================================

  /**
   * Check if there is an active search with matches.
   */
  public isActive(): boolean {
    const cursor = this.searchManager?.getCursor();
    return cursor !== undefined && cursor.total > 0;
  }

  /**
   * Check if there is a search cursor (may have zero matches).
   */
  public hasCursor(): boolean {
    return this.searchManager?.getCursor() !== undefined;
  }

  /**
   * Get the current search cursor.
   *
   * @returns Current cursor or undefined if no active search
   */
  public getCursor(): SearchCursor<E> | undefined {
    return this.searchManager?.getCursor();
  }

  /**
   * Search events using predicate function.
   * Returns FlameChartCursor that automatically handles centering, tooltips, and rendering.
   *
   * @param predicate - Function to test each event
   * @param options - Search options (caseSensitive, matchWholeWord)
   * @returns FlameChartCursor for navigating results, or null if search not initialized
   */
  public search(predicate: (event: E) => boolean, options?: SearchOptions): SearchCursor<E> | null {
    if (!this.searchManager) {
      return null;
    }

    // PERF: Initialize renderers on first search call (~6ms deferred from init)
    this.ensureRenderersInitialized();

    // Clear selection when starting a new search to show search highlights
    this.callbacks.onClearSelection();

    const innerCursor = this.searchManager.search(predicate, options);

    // Request render to update display with new search state
    // (especially important when search returns 0 results to clear old highlights)
    this.callbacks.requestRender();

    // Wrap with FlameChartCursor to add automatic side effects
    return new FlameChartCursor(innerCursor, (match) => {
      // Restore cursor if it was cleared (e.g., by Escape key)
      if (!this.searchManager?.getCursor()) {
        this.searchManager?.setCursor(innerCursor as SearchCursorImpl<E>);
      }
      this.handleSearchNavigation(match);
    });
  }

  /**
   * Clear current search and reset cursor.
   */
  public clearSearch(): void {
    this.searchManager?.clear();
    this.callbacks.requestRender();
  }

  // ============================================================================
  // RENDER - STYLED EVENTS
  // ============================================================================

  /**
   * Render events with search styling (desaturation for non-matches).
   * Call this instead of batchRenderer when search is active.
   *
   * @param context - Render context with viewport state, visible rects, and buckets
   */
  public renderStyledEvents(context: SearchRenderContext): void {
    if (!this.searchManager) {
      return;
    }

    // Ensure renderers are initialized before rendering
    this.ensureRenderersInitialized();

    if (!this.searchStyleRenderer) {
      return;
    }

    const cursor = this.searchManager.getCursor();
    if (!cursor) {
      return;
    }

    const matchedEventIds = cursor.getMatchedEventIds();
    const matchedEventsInfo = cursor.getMatchedEventsInfo();
    this.searchStyleRenderer.render(
      context.visibleRects,
      matchedEventIds,
      context.buckets,
      context.viewportState,
      matchedEventsInfo,
    );
  }

  /**
   * Clear the styled event rendering.
   */
  public clearStyledEvents(): void {
    this.searchStyleRenderer?.clear();
  }

  // ============================================================================
  // RENDER - STYLED LABELS
  // ============================================================================

  /**
   * Render text labels with search styling.
   * Call this instead of textLabelRenderer when search is active.
   *
   * @param context - Render context with viewport state and visible rects
   */
  public renderStyledLabels(context: SearchRenderContext): void {
    if (!this.searchManager) {
      return;
    }

    // Ensure renderers are initialized before rendering
    this.ensureRenderersInitialized();

    if (!this.searchTextLabelRenderer) {
      return;
    }

    const cursor = this.searchManager.getCursor();
    if (!cursor) {
      return;
    }

    const matchedEventIds = cursor.getMatchedEventIds();
    this.searchTextLabelRenderer.render(
      context.visibleRects,
      matchedEventIds,
      context.viewportState,
    );
  }

  /**
   * Clear the styled label rendering.
   */
  public clearStyledLabels(): void {
    this.searchTextLabelRenderer?.clear();
  }

  // ============================================================================
  // RENDER - HIGHLIGHT
  // ============================================================================

  /**
   * Render the current match highlight.
   *
   * @param viewportState - Current viewport state
   */
  public renderHighlight(viewportState: ViewportState): void {
    if (!this.searchManager) {
      return;
    }

    // Ensure renderers are initialized before rendering
    this.ensureRenderersInitialized();

    if (!this.searchHighlightRenderer) {
      return;
    }

    const cursor = this.searchManager.getCursor();
    if (!cursor) {
      return;
    }

    this.searchHighlightRenderer.render(cursor, viewportState);
  }

  /**
   * Clear the highlight rendering.
   */
  public clearHighlight(): void {
    this.searchHighlightRenderer?.clear();
  }

  // ============================================================================
  // PRIVATE - NAVIGATION
  // ============================================================================

  /**
   * Handle search navigation side effects:
   * - Clear selection so search highlight shows
   * - Center viewport on match
   * - Call onSearchNavigate callback for application-specific logic (e.g., tooltips)
   * - Request render
   */
  private handleSearchNavigation(match: { event: E; depth: number }): void {
    if (!this.viewport) {
      return;
    }

    // Clear selection so search highlight shows
    this.callbacks.onClearSelection();

    // Center viewport on the match
    this.callbacks.onCenterOnMatch(match.event.timestamp, match.event.duration, match.depth);

    // Calculate screen coordinates for tooltip positioning
    const screenX = this.viewport.calculateVisibleCenterX(
      match.event.timestamp,
      match.event.duration,
    );
    const screenY = this.viewport.depthToScreenY(match.depth) + this.mainTimelineYOffset;

    // Notify callback for tooltip
    this.callbacks.onSearchNavigate(match.event, screenX, screenY, match.depth);

    // Request render to show updated highlight
    this.callbacks.requestRender();
  }
}
