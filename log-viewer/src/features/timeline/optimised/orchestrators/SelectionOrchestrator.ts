/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * SelectionOrchestrator
 *
 * Orchestrates selection functionality (frame and marker selection).
 * Owns selection state, renderer, and navigation logic.
 *
 * Responsibilities:
 * - Selection lifecycle (select, clear, navigate)
 * - Selection rendering via SelectionHighlightRenderer
 * - Coordinate calculations for tooltip positioning
 *
 * Communication pattern:
 * - Uses callbacks to notify FlameChart of selection changes and viewport requests
 * - Receives ViewportState as read-only input
 * - Never mutates viewport directly (viewport operations go through callbacks)
 */

import * as PIXI from 'pixi.js';
import type { LogEvent } from '../../../../core/log-parser/LogEvents.js';
import type {
  EventNode,
  TimelineMarker,
  TreeNode,
  ViewportState,
} from '../../types/flamechart.types.js';
import type { NavigationMaps } from '../../utils/tree-converter.js';
import type { FrameNavDirection } from '../interaction/KeyboardHandler.js';
import { SelectionHighlightRenderer } from '../selection/SelectionHighlightRenderer.js';
import { SelectionManager, type MarkerNavDirection } from '../selection/SelectionManager.js';
import type { TimelineViewport } from '../TimelineViewport.js';

// Re-export types for convenience
export type { MarkerNavDirection };

/**
 * Callbacks for selection orchestrator events.
 */
export interface SelectionOrchestratorCallbacks {
  /**
   * Called when frame selection changes.
   *
   * @param event - Selected event data, or null if cleared
   */
  onSelectionChange: (event: EventNode | null) => void;

  /**
   * Called when marker selection changes.
   *
   * @param marker - Selected marker, or null if cleared
   */
  onMarkerSelectionChange: (marker: TimelineMarker | null) => void;

  /**
   * Called when viewport should center on a frame.
   * Returns target offset for animation.
   *
   * @param timestamp - Event start time in nanoseconds
   * @param duration - Event duration in nanoseconds
   * @param depth - Event depth in tree
   * @returns Target offset { x, y } for animation
   */
  onCenterOnFrame: (
    timestamp: number,
    duration: number,
    depth: number,
  ) => { x: number; y: number } | null;

  /**
   * Called when viewport should center on a marker.
   * Returns target offset for animation.
   *
   * @param startTime - Marker start time in nanoseconds
   * @param duration - Marker duration in nanoseconds
   * @param depth - Depth for centering (usually middle depth)
   * @returns Target offset { x, y } for animation
   */
  onCenterOnMarker: (
    startTime: number,
    duration: number,
    depth: number,
  ) => { x: number; y: number } | null;

  /**
   * Called when viewport should focus (zoom to fit) on a frame.
   *
   * @param timestamp - Event start time in nanoseconds
   * @param duration - Event duration in nanoseconds
   * @param depth - Event depth in tree
   */
  onFocusOnFrame: (timestamp: number, duration: number, depth: number) => void;

  /**
   * Called when viewport should focus (zoom to fit) on a marker.
   *
   * @param startTime - Marker start time in nanoseconds
   * @param duration - Marker duration in nanoseconds
   * @param depth - Depth for centering (usually middle depth)
   */
  onFocusOnMarker: (startTime: number, duration: number, depth: number) => void;

  /**
   * Called when keyboard navigation moves to a frame.
   * Includes screen coordinates for tooltip positioning.
   *
   * @param event - Event data
   * @param screenX - Screen X coordinate (container-relative)
   * @param screenY - Screen Y coordinate (container-relative)
   * @param depth - Event depth
   */
  onFrameNavigate: (event: EventNode, screenX: number, screenY: number, depth: number) => void;

  /**
   * Called when keyboard navigation moves to a marker.
   * Includes screen coordinates for tooltip positioning.
   *
   * @param marker - Marker data
   * @param screenX - Screen X coordinate (container-relative)
   * @param screenY - Screen Y coordinate (container-relative)
   */
  onMarkerNavigate: (marker: TimelineMarker, screenX: number, screenY: number) => void;

  /**
   * Called to animate viewport to target position.
   *
   * @param targetX - Target offsetX
   * @param targetY - Target offsetY
   * @param durationMs - Animation duration in milliseconds
   */
  onAnimateToPosition: (targetX: number, targetY: number, durationMs: number) => void;

  /**
   * Called when a re-render is needed.
   */
  requestRender: () => void;
}

/**
 * Context for rendering selection overlays.
 */
export interface SelectionRenderContext {
  /** Current viewport state */
  viewportState: ViewportState;
}

export class SelectionOrchestrator<E extends EventNode = EventNode> {
  // ============================================================================
  // SELECTION COMPONENTS
  // ============================================================================
  private selectionManager: SelectionManager<E> | null = null;
  private selectionRenderer: SelectionHighlightRenderer | null = null;

  // ============================================================================
  // EXTERNAL REFERENCES (not owned)
  // ============================================================================
  private viewport: TimelineViewport | null = null;
  private totalDuration: number = 0;
  private maxDepth: number = 0;
  private mainTimelineYOffset: number = 0;

  private callbacks: SelectionOrchestratorCallbacks;

  constructor(callbacks: SelectionOrchestratorCallbacks) {
    this.callbacks = callbacks;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Initialize the selection system.
   *
   * @param worldContainer - PixiJS container for renderer
   * @param viewport - Main timeline viewport (for coordinate calculations)
   * @param treeNodes - Pre-converted TreeNode structure for navigation
   * @param maps - Pre-built navigation maps from tree conversion
   * @param markers - Timeline markers for marker selection
   * @param totalDuration - Total timeline duration in nanoseconds
   * @param maxDepth - Maximum depth in the timeline
   * @param mainTimelineYOffset - Offset from container top to main timeline canvas
   */
  public init(
    worldContainer: PIXI.Container,
    viewport: TimelineViewport,
    treeNodes: TreeNode<E>[],
    maps: NavigationMaps,
    markers: TimelineMarker[],
    totalDuration: number,
    maxDepth: number,
    mainTimelineYOffset: number,
  ): void {
    this.viewport = viewport;
    this.totalDuration = totalDuration;
    this.maxDepth = maxDepth;
    this.mainTimelineYOffset = mainTimelineYOffset;

    // Initialize selection manager
    this.selectionManager = new SelectionManager<E>(treeNodes, maps);
    this.selectionManager.setMarkers(markers);

    // Initialize selection highlight renderer
    this.selectionRenderer = new SelectionHighlightRenderer(worldContainer);
    this.selectionRenderer.setMarkerContext(markers, totalDuration);
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
   * Clean up all selection resources.
   */
  public destroy(): void {
    if (this.selectionRenderer) {
      this.selectionRenderer.destroy();
      this.selectionRenderer = null;
    }
    this.selectionManager = null;
    this.viewport = null;
  }

  // ============================================================================
  // PUBLIC API - QUERIES
  // ============================================================================

  /**
   * Check if there is an active frame selection.
   */
  public hasSelection(): boolean {
    return this.selectionManager?.hasSelection() ?? false;
  }

  /**
   * Check if there is an active marker selection.
   */
  public hasMarkerSelection(): boolean {
    return this.selectionManager?.hasMarkerSelection() ?? false;
  }

  /**
   * Check if there is any selection (frame or marker).
   */
  public hasAnySelection(): boolean {
    return this.selectionManager?.hasAnySelection() ?? false;
  }

  /**
   * Get the currently selected frame node.
   */
  public getSelectedNode(): TreeNode<E> | null {
    return this.selectionManager?.getSelected() ?? null;
  }

  /**
   * Get the currently selected marker.
   */
  public getSelectedMarker(): TimelineMarker | null {
    return this.selectionManager?.getSelectedMarker() ?? null;
  }

  /**
   * Get all markers.
   */
  public getMarkers(): TimelineMarker[] {
    return this.selectionManager?.getMarkers() ?? [];
  }

  /**
   * Find a TreeNode by its original LogEvent reference.
   * Used to map hit test results back to tree nodes for selection.
   */
  public findByOriginal(logEvent: LogEvent): TreeNode<E> | null {
    return this.selectionManager?.findByOriginal(logEvent) ?? null;
  }

  // ============================================================================
  // PUBLIC API - SELECTION
  // ============================================================================

  /**
   * Select a frame (TreeNode).
   * Updates visual highlight and notifies callback.
   *
   * @param node - TreeNode to select
   */
  public selectFrame(node: TreeNode<E>): void {
    this.selectionManager?.select(node);
    this.callbacks.onSelectionChange(node.data);
    this.callbacks.requestRender();
  }

  /**
   * Select a marker.
   * Updates visual highlight and notifies callback.
   *
   * @param marker - TimelineMarker to select
   */
  public selectMarker(marker: TimelineMarker): void {
    this.selectionManager?.selectMarker(marker);
    this.callbacks.onMarkerSelectionChange(marker);
    this.callbacks.requestRender();
  }

  /**
   * Clear the current selection (frame or marker).
   */
  public clearSelection(): void {
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
    if (hadFrameSelection) {
      this.callbacks.onSelectionChange(null);
    }
    if (hadMarkerSelection) {
      this.callbacks.onMarkerSelectionChange(null);
    }

    this.callbacks.requestRender();
  }

  // ============================================================================
  // PUBLIC API - NAVIGATION
  // ============================================================================

  /**
   * Navigate frame selection using tree navigation.
   * Called by keyboard handler for arrow key navigation.
   *
   * @param direction - Navigation direction
   * @returns true if navigation was handled (selection changed or stayed at boundary)
   */
  public navigateFrame(direction: FrameNavDirection): boolean {
    if (!this.selectionManager?.hasSelection()) {
      return false;
    }

    const nextNode = this.selectionManager.navigate(direction);

    if (nextNode) {
      this.callbacks.onSelectionChange(nextNode.data);
      this.callbacks.requestRender();

      // Auto-center viewport on the newly selected frame
      this.centerOnSelectedFrame();

      // Notify navigation callback for tooltip
      if (this.viewport) {
        const depth = nextNode.depth ?? 0;
        const screenX = this.viewport.calculateVisibleCenterX(
          nextNode.data.timestamp,
          nextNode.data.duration,
        );
        const screenY = this.viewport.depthToScreenY(depth) + this.mainTimelineYOffset;
        this.callbacks.onFrameNavigate(nextNode.data, screenX, screenY, depth);
      }
    }

    // Return true if we have a selection (even if we couldn't navigate further)
    return true;
  }

  /**
   * Navigate marker selection.
   * Called by keyboard handler for arrow key navigation on markers.
   *
   * @param direction - Navigation direction ('left' for previous, 'right' for next)
   * @returns true if navigation was handled (marker is selected)
   */
  public navigateMarker(direction: MarkerNavDirection): boolean {
    if (!this.selectionManager?.hasMarkerSelection()) {
      return false;
    }

    const nextMarker = this.selectionManager.navigateMarker(direction);

    if (nextMarker) {
      this.callbacks.onMarkerSelectionChange(nextMarker);
      this.callbacks.requestRender();

      // Auto-center viewport on the newly selected marker
      this.centerOnSelectedMarker();

      // Notify navigation callback for tooltip
      if (this.viewport) {
        const screenX = this.viewport.calculateVisibleCenterX(nextMarker.startTime, 0);
        // Markers span full height - position tooltip near top of visible area
        const screenY = 50 + this.mainTimelineYOffset;
        this.callbacks.onMarkerNavigate(nextMarker, screenX, screenY);
      }
    }

    // Return true if we have a marker selection (even if we couldn't navigate further)
    return true;
  }

  // ============================================================================
  // PUBLIC API - VIEWPORT OPERATIONS
  // ============================================================================

  /**
   * Center viewport on the currently selected frame.
   * Uses smooth animation when navigating to off-screen frames.
   */
  public centerOnSelectedFrame(): void {
    const selectedNode = this.selectionManager?.getSelected();
    if (!selectedNode || !this.viewport) {
      return;
    }

    const event = selectedNode.data;
    const depth = selectedNode.depth ?? 0;

    // Request target offset calculation via callback
    const targetOffset = this.callbacks.onCenterOnFrame(event.timestamp, event.duration, depth);

    if (!targetOffset) {
      return;
    }

    // Check if viewport needs to move
    const currentState = this.viewport.getState();
    const needsAnimation =
      Math.abs(targetOffset.x - currentState.offsetX) > 1 ||
      Math.abs(targetOffset.y - currentState.offsetY) > 1;

    if (needsAnimation) {
      this.callbacks.onAnimateToPosition(targetOffset.x, targetOffset.y, 300);
    }
  }

  /**
   * Focus viewport on the currently selected frame (zoom to fit).
   * Calculates optimal zoom to fit the frame with padding.
   */
  public focusOnSelectedFrame(): void {
    const selectedNode = this.selectionManager?.getSelected();
    if (!selectedNode) {
      return;
    }

    const event = selectedNode.data;
    const depth = selectedNode.depth ?? 0;

    this.callbacks.onFocusOnFrame(event.timestamp, event.duration, depth);
  }

  /**
   * Center viewport on the currently selected marker.
   * Uses smooth animation when navigating to off-screen markers.
   */
  public centerOnSelectedMarker(): void {
    const selectedMarker = this.selectionManager?.getSelectedMarker();
    if (!selectedMarker || !this.viewport) {
      return;
    }

    // Calculate marker duration (extends to next marker or timeline end)
    const markers = this.selectionManager?.getMarkers() ?? [];
    const markerIndex = markers.findIndex((m) => m.id === selectedMarker.id);
    const nextMarker = markers[markerIndex + 1];
    const markerEnd = nextMarker?.startTime ?? this.totalDuration;
    const duration = markerEnd - selectedMarker.startTime;

    // Use middle depth for centering (markers span all depths)
    const middleDepth = Math.floor(this.maxDepth / 2);

    // Request target offset calculation via callback
    const targetOffset = this.callbacks.onCenterOnMarker(
      selectedMarker.startTime,
      duration,
      middleDepth,
    );

    if (!targetOffset) {
      return;
    }

    // Check if viewport needs to move
    const currentState = this.viewport.getState();
    const needsAnimation =
      Math.abs(targetOffset.x - currentState.offsetX) > 1 ||
      Math.abs(targetOffset.y - currentState.offsetY) > 1;

    if (needsAnimation) {
      this.callbacks.onAnimateToPosition(targetOffset.x, targetOffset.y, 300);
    }
  }

  /**
   * Focus viewport on the currently selected marker (zoom to fit).
   * Calculates optimal zoom to fit the marker with padding.
   */
  public focusOnSelectedMarker(): void {
    const selectedMarker = this.selectionManager?.getSelectedMarker();
    if (!selectedMarker) {
      return;
    }

    // Calculate marker duration (extends to next marker or timeline end)
    const markers = this.selectionManager?.getMarkers() ?? [];
    const markerIndex = markers.findIndex((m) => m.id === selectedMarker.id);
    const nextMarker = markers[markerIndex + 1];
    const markerEnd = nextMarker?.startTime ?? this.totalDuration;
    const duration = markerEnd - selectedMarker.startTime;

    // Use middle depth for focusing (markers span all depths)
    const middleDepth = Math.floor(this.maxDepth / 2);

    this.callbacks.onFocusOnMarker(selectedMarker.startTime, duration, middleDepth);
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  /**
   * Render selection highlight overlay.
   *
   * @param context - Render context with viewport state
   */
  public render(context: SelectionRenderContext): void {
    if (!this.selectionRenderer || !this.selectionManager) {
      return;
    }

    const selectedNode = this.selectionManager.getSelected() as TreeNode<EventNode> | null;
    const selectedMarker = this.selectionManager.getSelectedMarker();

    this.selectionRenderer.render(context.viewportState, selectedNode, selectedMarker);
  }

  /**
   * Clear the selection highlight from display.
   */
  public clearRender(): void {
    this.selectionRenderer?.clear();
  }

  /**
   * Refresh colors from CSS variables (e.g., after theme change).
   */
  public refreshColors(): void {
    this.selectionRenderer?.refreshColors();
  }
}
