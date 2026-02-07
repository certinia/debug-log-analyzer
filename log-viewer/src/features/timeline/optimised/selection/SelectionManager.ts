/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * SelectionManager
 *
 * Owns selection state and logic for flame chart selection (frames and markers).
 * Encapsulates TreeNavigator and provides a clean API for selection operations.
 *
 * Responsibilities:
 * - Owns selectedNode state (frame selection)
 * - Owns selectedMarker state (marker selection)
 * - Owns TreeNavigator instance (internal)
 * - Provides selection lifecycle (select, clear, navigate)
 * - Maps LogEvent to TreeNode for hit test integration
 *
 * Selection is mutually exclusive: selecting a frame clears marker selection and vice versa.
 */

import type { LogEvent } from '../../../../core/log-parser/LogEvents.js';
import type { EventNode, TimelineMarker, TreeNode } from '../../types/flamechart.types.js';
import type { NavigationMaps } from '../../utils/tree-converter.js';
import type { FrameNavDirection } from '../interaction/KeyboardHandler.js';
import { TreeNavigator } from './TreeNavigator.js';

/**
 * Direction for marker navigation.
 */
export type MarkerNavDirection = 'left' | 'right';

/**
 * Selection type discriminator.
 */
export type SelectionType = 'none' | 'frame' | 'marker';

export class SelectionManager<E extends EventNode> {
  /** Currently selected node (frame) */
  private selectedNode: TreeNode<E> | null = null;

  /** Currently selected marker */
  private selectedMarker: TimelineMarker | null = null;

  /** All markers for navigation (sorted by startTime) */
  private markers: TimelineMarker[] = [];

  /** Tree navigator for traversal operations */
  private navigator: TreeNavigator;

  /**
   * Create a SelectionManager from tree nodes and pre-built maps.
   *
   * @param treeNodes - Root-level TreeNodes to navigate
   * @param maps - Pre-built navigation maps from tree conversion
   */
  constructor(treeNodes: TreeNode<E>[], maps: NavigationMaps) {
    this.navigator = new TreeNavigator(treeNodes as TreeNode<EventNode>[], maps);
  }

  /**
   * Set the markers array for marker navigation.
   * Markers should be sorted by startTime.
   *
   * @param markers - Array of timeline markers
   */
  public setMarkers(markers: TimelineMarker[]): void {
    this.markers = markers;
  }

  /**
   * Get all markers.
   *
   * @returns Array of timeline markers
   */
  public getMarkers(): TimelineMarker[] {
    return this.markers;
  }

  /**
   * Select a tree node (frame).
   * Clears any marker selection (mutually exclusive).
   *
   * @param node - TreeNode to select
   */
  public select(node: TreeNode<E>): void {
    this.selectedNode = node;
    this.selectedMarker = null; // Clear marker selection
  }

  /**
   * Select a marker.
   * Clears any frame selection (mutually exclusive).
   *
   * @param marker - TimelineMarker to select
   */
  public selectMarker(marker: TimelineMarker): void {
    this.selectedMarker = marker;
    this.selectedNode = null; // Clear frame selection
  }

  /**
   * Clear the current selection (frame or marker).
   */
  public clear(): void {
    this.selectedNode = null;
    this.selectedMarker = null;
  }

  /**
   * Clear only the frame selection.
   */
  public clearFrame(): void {
    this.selectedNode = null;
  }

  /**
   * Clear only the marker selection.
   */
  public clearMarker(): void {
    this.selectedMarker = null;
  }

  /**
   * Navigate from current selection in the specified direction.
   * Returns the new node if navigation was successful, null if at boundary.
   *
   * For left/right navigation: tries siblings first, then falls back to
   * cross-parent navigation at the same depth (Chrome DevTools behavior).
   *
   * @param direction - Navigation direction ('up', 'down', 'left', 'right')
   * @returns New selected node, or null if at boundary or no selection
   */
  public navigate(direction: FrameNavDirection): TreeNode<E> | null {
    if (!this.selectedNode) {
      return null;
    }

    const currentNode = this.selectedNode as TreeNode<EventNode>;
    let nextNode: TreeNode<EventNode> | null = null;

    switch (direction) {
      case 'up':
        // Visual up = into children (flame charts render depth 0 at bottom)
        nextNode = this.navigator.getChildAtCenter(currentNode);
        break;
      case 'down':
        // Visual down = to parent
        nextNode = this.navigator.getParent(currentNode);
        break;
      case 'left':
        // Try sibling first, then cross-parent at same depth
        nextNode = this.navigator.getPrevSibling(currentNode);
        if (!nextNode) {
          nextNode = this.navigator.getPrevAtDepth(currentNode);
        }
        break;
      case 'right':
        // Try sibling first, then cross-parent at same depth
        nextNode = this.navigator.getNextSibling(currentNode);
        if (!nextNode) {
          nextNode = this.navigator.getNextAtDepth(currentNode);
        }
        break;
    }

    if (nextNode) {
      this.selectedNode = nextNode as TreeNode<E>;
      return this.selectedNode;
    }

    return null;
  }

  /**
   * Get the currently selected node (frame).
   *
   * @returns Currently selected TreeNode, or null if none
   */
  public getSelected(): TreeNode<E> | null {
    return this.selectedNode;
  }

  /**
   * Get the currently selected marker.
   *
   * @returns Currently selected TimelineMarker, or null if none
   */
  public getSelectedMarker(): TimelineMarker | null {
    return this.selectedMarker;
  }

  /**
   * Check if there is an active frame selection.
   *
   * @returns true if a frame node is selected
   */
  public hasSelection(): boolean {
    return this.selectedNode !== null;
  }

  /**
   * Check if there is an active marker selection.
   *
   * @returns true if a marker is selected
   */
  public hasMarkerSelection(): boolean {
    return this.selectedMarker !== null;
  }

  /**
   * Check if there is any selection (frame or marker).
   *
   * @returns true if anything is selected
   */
  public hasAnySelection(): boolean {
    return this.selectedNode !== null || this.selectedMarker !== null;
  }

  /**
   * Get the current selection type.
   *
   * @returns 'none' | 'frame' | 'marker'
   */
  public getSelectionType(): SelectionType {
    if (this.selectedNode !== null) {
      return 'frame';
    }
    if (this.selectedMarker !== null) {
      return 'marker';
    }
    return 'none';
  }

  /**
   * Navigate between markers in the specified direction.
   * Returns the new marker if navigation was successful, null if at boundary.
   *
   * @param direction - Navigation direction ('left' for previous, 'right' for next)
   * @returns New selected marker, or null if at boundary or no marker selection
   */
  public navigateMarker(direction: MarkerNavDirection): TimelineMarker | null {
    if (!this.selectedMarker || this.markers.length === 0) {
      return null;
    }

    const currentIndex = this.markers.findIndex((m) => m.id === this.selectedMarker!.id);
    if (currentIndex === -1) {
      return null;
    }

    const nextIndex = direction === 'right' ? currentIndex + 1 : currentIndex - 1;

    // Check boundaries (no wrapping)
    if (nextIndex < 0 || nextIndex >= this.markers.length) {
      return null;
    }

    const nextMarker = this.markers[nextIndex];
    if (!nextMarker) {
      return null;
    }

    this.selectedMarker = nextMarker;
    return this.selectedMarker;
  }

  /**
   * Find a TreeNode by its original LogEvent reference.
   * Used to map hit test results back to tree nodes for selection.
   *
   * @param logEvent - Original LogEvent from hit test
   * @returns The TreeNode, or null if not found
   */
  public findByOriginal(logEvent: LogEvent): TreeNode<E> | null {
    return this.navigator.findByOriginal(logEvent) as TreeNode<E> | null;
  }

  /**
   * Find a TreeNode by its event ID.
   *
   * @param id - Event ID to search for
   * @returns The TreeNode, or null if not found
   */
  public findById(id: string): TreeNode<E> | null {
    return this.navigator.findById(id) as TreeNode<E> | null;
  }
}
