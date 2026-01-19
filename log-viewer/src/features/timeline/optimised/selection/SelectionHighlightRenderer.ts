/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SelectionHighlightRenderer
 *
 * Rendering layer for selection highlight using PixiJS Graphics.
 * Draws an orange highlight around the selected frame with viewport culling.
 *
 * Uses shared HighlightRenderer for consistent styling with SearchHighlightRenderer.
 * Selection highlight looks identical to search match highlight.
 */

import * as PIXI from 'pixi.js';
import type { EventNode, TreeNode, ViewportState } from '../../types/flamechart.types.js';
import { TIMELINE_CONSTANTS } from '../../types/flamechart.types.js';
import {
  extractHighlightColors,
  renderHighlight,
  type HighlightColors,
} from '../rendering/HighlightRenderer.js';

/**
 * Culling bounds derived from viewport.
 */
interface CullingBounds {
  /** Start time in nanoseconds */
  timeStart: number;
  /** End time in nanoseconds */
  timeEnd: number;
  /** Start depth (0-indexed) */
  depthStart: number;
  /** End depth (0-indexed) */
  depthEnd: number;
}

/**
 * SelectionHighlightRenderer
 *
 * Renders selection highlight as an orange overlay + border around the selected frame.
 * Uses a single Graphics layer since selection is singular.
 * Styling is identical to search match highlight via shared HighlightRenderer.
 */
export class SelectionHighlightRenderer {
  /** Graphics for selection highlight */
  private graphics: PIXI.Graphics;

  /** Currently selected node */
  private selectedNode: TreeNode<EventNode> | null = null;

  /** Highlight colors extracted from CSS variables (same as search) */
  private colors: HighlightColors;

  /**
   * @param container - PixiJS container to add graphics to (worldContainer)
   */
  constructor(container: PIXI.Container) {
    this.graphics = new PIXI.Graphics();

    // Set z-index higher than search highlights for visibility
    this.graphics.zIndex = 3;

    container.addChild(this.graphics);

    // Extract colors from shared utility (same colors as search highlight)
    this.colors = extractHighlightColors();
  }

  /**
   * Set the currently selected node.
   *
   * @param node - TreeNode to select, or null to clear selection
   */
  public setSelection(node: TreeNode<EventNode> | null): void {
    this.selectedNode = node;
  }

  /**
   * Get the currently selected node.
   *
   * @returns Currently selected TreeNode, or null if none
   */
  public getSelection(): TreeNode<EventNode> | null {
    return this.selectedNode;
  }

  /**
   * Render the selection highlight.
   *
   * @param viewport - Viewport state for culling and transforms
   */
  public render(viewport: ViewportState): void {
    this.graphics.clear();

    if (!this.selectedNode) {
      return;
    }

    const bounds = this.calculateBounds(viewport);
    const event = this.selectedNode.data;
    const depth = this.selectedNode.depth ?? 0;

    // Check visibility
    if (!this.isVisible(event, depth, bounds)) {
      return;
    }

    // Use shared highlight rendering logic (same styling as search highlight)
    renderHighlight(this.graphics, event.timestamp, event.duration, depth, viewport, this.colors);
  }

  /**
   * Clear the selection highlight from display.
   */
  public clear(): void {
    this.graphics.clear();
    this.selectedNode = null;
  }

  /**
   * Destroy renderer and cleanup resources.
   */
  public destroy(): void {
    this.graphics.destroy();
  }

  /**
   * Calculate culling bounds from viewport state.
   *
   * @param viewport - Viewport state
   * @returns Culling bounds in timeline coordinates
   */
  private calculateBounds(viewport: ViewportState): CullingBounds {
    const timeStart = viewport.offsetX / viewport.zoom;
    const timeEnd = (viewport.offsetX + viewport.displayWidth) / viewport.zoom;

    // Viewport culling for vertical (depth-based)
    const worldYBottom = -viewport.offsetY;
    const worldYTop = -viewport.offsetY + viewport.displayHeight;

    const EVENT_HEIGHT = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const depthStart = Math.floor(worldYBottom / EVENT_HEIGHT);
    const depthEnd = Math.floor(worldYTop / EVENT_HEIGHT);

    return { timeStart, timeEnd, depthStart, depthEnd };
  }

  /**
   * Check if event is visible within culling bounds.
   *
   * @param event - Event to test
   * @param depth - Depth of event in tree
   * @param bounds - Culling bounds
   * @returns true if event is visible
   */
  private isVisible(event: EventNode, depth: number, bounds: CullingBounds): boolean {
    const rectTimeStart = event.timestamp;
    const rectTimeEnd = rectTimeStart + event.duration;

    if (rectTimeEnd <= bounds.timeStart || rectTimeStart >= bounds.timeEnd) {
      return false;
    }

    if (depth < bounds.depthStart || depth > bounds.depthEnd) {
      return false;
    }

    return true;
  }
}
