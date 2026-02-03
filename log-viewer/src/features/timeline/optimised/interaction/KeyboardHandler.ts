/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * KeyboardHandler
 *
 * Handles keyboard input for flame chart viewport controls.
 * Manages pan, zoom, and reset operations via keyboard shortcuts.
 */

import type { TimelineViewport } from '../TimelineViewport.js';

/**
 * Configuration constants for keyboard interactions.
 */
export const KEYBOARD_CONSTANTS = {
  /** Percentage of viewport to pan per keypress (reduced for smoother feel) */
  panStepPercent: 0.05,
  /** Zoom multiplier per keypress (reduced for smoother feel) */
  zoomFactor: 1.2,
} as const;

/**
 * Navigation direction for frame traversal.
 */
export type FrameNavDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Navigation direction for marker traversal (horizontal only).
 */
export type MarkerNavDirection = 'left' | 'right';

/**
 * Callbacks for keyboard events.
 */
export interface KeyboardCallbacks {
  /** Called when viewport should pan by delta pixels. */
  onPan?: (deltaX: number, deltaY: number) => void;

  /** Called when viewport should zoom in or out. */
  onZoom?: (direction: 'in' | 'out') => void;

  /** Called when viewport should reset to show all content. */
  onResetZoom?: () => void;

  /** Called when Escape key is pressed (cancel/deselect). */
  onEscape?: () => void;

  /**
   * Called when arrow key is pressed for frame navigation.
   * In a flame chart (depth 0 at bottom, children visually above):
   * - up: Navigate to child frame (visually up, deeper in call stack)
   * - down: Navigate to parent frame (visually down, shallower in call stack)
   * - left: Navigate to previous sibling frame
   * - right: Navigate to next sibling frame
   *
   * Returns true if navigation was handled (frame was selected),
   * false to fall through to pan behavior.
   */
  onFrameNav?: (direction: FrameNavDirection) => boolean;

  /**
   * Called when arrow key is pressed for marker navigation.
   * Markers only support horizontal navigation (left/right).
   * - left: Navigate to previous marker (by time)
   * - right: Navigate to next marker (by time)
   *
   * Returns true if navigation was handled (marker was selected),
   * false to fall through to frame navigation or pan behavior.
   */
  onMarkerNav?: (direction: MarkerNavDirection) => boolean;

  /**
   * Called when J key is pressed for "Jump to Call Tree".
   * Navigates the call tree to the currently selected frame or marker.
   */
  onJumpToCallTree?: () => void;

  /**
   * Called when Enter or Z key is pressed for "Focus" (zoom to fit).
   * Zooms the viewport to fit the currently selected frame with padding.
   */
  onFocus?: () => void;

  /**
   * Called when Ctrl/Cmd+C is pressed to copy the selected frame name.
   */
  onCopy?: () => void;

  // ============================================================================
  // MINIMAP KEYBOARD CALLBACKS
  // ============================================================================

  /**
   * Called to check if the mouse is currently in the minimap area.
   * Used to determine whether to use minimap-specific key bindings.
   */
  isInMinimapArea?: () => boolean;

  /**
   * Called when arrow keys are pressed to pan the minimap viewport lens.
   * @param deltaTimeNs - Time delta in nanoseconds (positive = right)
   */
  onMinimapPanViewport?: (deltaTimeNs: number) => void;

  /**
   * Called when arrow up/down are pressed to pan depth in minimap.
   * @param deltaY - Pixel delta (positive = down, showing shallower frames)
   */
  onMinimapPanDepth?: (deltaY: number) => void;

  /**
   * Called when +/-/W/S is pressed in minimap to zoom the selection.
   * @param direction - 'in' to narrow the lens, 'out' to widen it
   */
  onMinimapZoom?: (direction: 'in' | 'out') => void;

  /**
   * Called when Home key is pressed in minimap to jump to start.
   */
  onMinimapJumpStart?: () => void;

  /**
   * Called when End key is pressed in minimap to jump to end.
   */
  onMinimapJumpEnd?: () => void;

  /**
   * Called when 0/Escape is pressed in minimap to reset zoom.
   */
  onMinimapResetZoom?: () => void;

  // ============================================================================
  // METRIC STRIP KEYBOARD CALLBACKS
  // ============================================================================

  /**
   * Called to check if the mouse is currently in the metric strip area.
   * Used to determine whether to use metric strip-specific key bindings.
   */
  isInMetricStripArea?: () => boolean;

  /**
   * Called when arrow keys are pressed to pan the metric strip viewport.
   * @param deltaTimeNs - Time delta in nanoseconds (positive = right)
   */
  onMetricStripPanViewport?: (deltaTimeNs: number) => void;

  /**
   * Called when arrow up/down are pressed to pan depth in metric strip.
   * @param deltaY - Pixel delta (positive = down, showing shallower frames)
   */
  onMetricStripPanDepth?: (deltaY: number) => void;

  /**
   * Called when +/-/W/S is pressed in metric strip to zoom.
   * @param direction - 'in' to zoom in, 'out' to zoom out
   */
  onMetricStripZoom?: (direction: 'in' | 'out') => void;

  /**
   * Called when Home key is pressed in metric strip to jump to start.
   */
  onMetricStripJumpStart?: () => void;

  /**
   * Called when End key is pressed in metric strip to jump to end.
   */
  onMetricStripJumpEnd?: () => void;

  /**
   * Called when 0/Escape is pressed in metric strip to reset zoom.
   */
  onMetricStripResetZoom?: () => void;
}

/**
 * Handles keyboard input for flame chart navigation.
 *
 * Key Mappings:
 * - W / + / = : Zoom in
 * - S / - : Zoom out
 * - Shift + W : Pan up (through stack depth)
 * - Shift + S : Pan down (through stack depth)
 * - A : Pan left
 * - D : Pan right
 * - Arrow keys (no modifier): Frame navigation (when frame selected), otherwise pan
 * - Shift + Arrow keys: Pan in direction (always, even with frame selected)
 * - Home / 0 : Reset zoom
 * - Escape : Cancel/deselect
 */
export class KeyboardHandler {
  private container: HTMLElement;
  private viewport: TimelineViewport;
  private callbacks: KeyboardCallbacks;

  private isAttached = false;

  // Bound handlers for cleanup
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;

  constructor(
    container: HTMLElement,
    viewport: TimelineViewport,
    callbacks: KeyboardCallbacks = {},
  ) {
    this.container = container;
    this.viewport = viewport;
    this.callbacks = callbacks;

    // Bind handlers
    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
  }

  /**
   * Attach keyboard event listeners to the container.
   */
  public attach(): void {
    if (this.isAttached) {
      return;
    }

    this.container.addEventListener('keydown', this.boundKeyDown);
    this.container.addEventListener('keyup', this.boundKeyUp);
    this.isAttached = true;
  }

  /**
   * Detach keyboard event listeners from the container.
   */
  public detach(): void {
    if (!this.isAttached) {
      return;
    }

    this.container.removeEventListener('keydown', this.boundKeyDown);
    this.container.removeEventListener('keyup', this.boundKeyUp);
    this.isAttached = false;
  }

  /**
   * Clean up all resources.
   */
  public destroy(): void {
    this.detach();
  }

  /**
   * Handle keydown events.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Check if mouse is in minimap area - use minimap-specific handling
    if (this.callbacks.isInMinimapArea?.()) {
      if (this.handleMinimapKeyDown(event)) {
        event.preventDefault();
        return;
      }
    }

    // Check if mouse is in metric strip area - use metric strip-specific handling
    if (this.callbacks.isInMetricStripArea?.()) {
      if (this.handleMetricStripKeyDown(event)) {
        event.preventDefault();
        return;
      }
    }

    // Determine action based on key combination (main timeline)
    if (this.handlePanKeys(event)) {
      event.preventDefault();
      return;
    }

    if (this.handleZoomKeys(event)) {
      event.preventDefault();
      return;
    }

    if (this.handleResetKeys(event)) {
      event.preventDefault();
      return;
    }

    if (this.handleEscapeKey(event)) {
      event.preventDefault();
      return;
    }

    if (this.handleJumpKey(event)) {
      event.preventDefault();
      return;
    }

    if (this.handleFocusKeys(event)) {
      event.preventDefault();
      return;
    }

    if (this.handleCopyKey(event)) {
      event.preventDefault();
      return;
    }
  }

  /**
   * Handle keydown events when mouse is in minimap area.
   * Returns true if event was handled.
   *
   * Key Mappings:
   * - Arrow Left/Right: Pan viewport lens horizontally
   * - Arrow Up/Down: Pan depth vertically
   * - W/+/=: Zoom selection in (narrow lens)
   * - S/-: Zoom selection out (widen lens)
   * - Home: Jump to timeline start
   * - End: Jump to timeline end
   * - 0/Escape: Reset zoom
   */
  private handleMinimapKeyDown(event: KeyboardEvent): boolean {
    // Don't handle if Ctrl/Alt/Meta is pressed (allow browser shortcuts)
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    const key = event.key.toLowerCase();

    // Pan viewport lens (Arrow keys)
    if (this.handleMinimapPanKeys(event)) {
      return true;
    }

    // Zoom selection (W/S/+/-/=)
    switch (key) {
      case 'w':
      case '+':
      case '=':
        this.callbacks.onMinimapZoom?.('in');
        return true;
      case 's':
      case '-':
        this.callbacks.onMinimapZoom?.('out');
        return true;
    }

    // Jump to start/end (Home/End)
    switch (event.key) {
      case 'Home':
        this.callbacks.onMinimapJumpStart?.();
        return true;
      case 'End':
        this.callbacks.onMinimapJumpEnd?.();
        return true;
    }

    // Reset zoom (0/Escape)
    if (key === '0' || event.key === 'Escape') {
      this.callbacks.onMinimapResetZoom?.();
      return true;
    }

    return false;
  }

  /**
   * Handle arrow keys for minimap pan.
   * - Left/Right: Pan viewport lens horizontally
   * - Up/Down: Pan depth vertically
   */
  private handleMinimapPanKeys(event: KeyboardEvent): boolean {
    const viewportState = this.viewport.getState();

    // Calculate pan step (5% of visible range, matching main timeline)
    const horizontalStep = viewportState.displayWidth * KEYBOARD_CONSTANTS.panStepPercent;
    const verticalStep = viewportState.displayHeight * KEYBOARD_CONSTANTS.panStepPercent;

    switch (event.key) {
      case 'ArrowLeft':
        // Pan viewport lens left - convert pixels to time
        this.callbacks.onMinimapPanViewport?.(-horizontalStep / viewportState.zoom);
        return true;
      case 'ArrowRight':
        // Pan viewport lens right - convert pixels to time
        this.callbacks.onMinimapPanViewport?.(horizontalStep / viewportState.zoom);
        return true;
      case 'ArrowUp':
        // Pan depth up - lens moves up visually (offsetY more negative)
        this.callbacks.onMinimapPanDepth?.(-verticalStep);
        return true;
      case 'ArrowDown':
        // Pan depth down - lens moves down visually (offsetY less negative)
        this.callbacks.onMinimapPanDepth?.(verticalStep);
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle keydown events when mouse is in metric strip area.
   * Returns true if event was handled.
   *
   * Key Mappings (mirrors minimap):
   * - Arrow Left/Right: Pan viewport horizontally
   * - Arrow Up/Down: Pan depth vertically
   * - W/+/=: Zoom in
   * - S/-: Zoom out
   * - Home: Jump to timeline start
   * - End: Jump to timeline end
   * - 0/Escape: Reset zoom
   */
  private handleMetricStripKeyDown(event: KeyboardEvent): boolean {
    // Don't handle if Ctrl/Alt/Meta is pressed (allow browser shortcuts)
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    const key = event.key.toLowerCase();

    // Pan viewport (Arrow keys)
    if (this.handleMetricStripPanKeys(event)) {
      return true;
    }

    // Zoom (W/S/+/-/=)
    switch (key) {
      case 'w':
      case '+':
      case '=':
        this.callbacks.onMetricStripZoom?.('in');
        return true;
      case 's':
      case '-':
        this.callbacks.onMetricStripZoom?.('out');
        return true;
    }

    // Jump to start/end (Home/End)
    switch (event.key) {
      case 'Home':
        this.callbacks.onMetricStripJumpStart?.();
        return true;
      case 'End':
        this.callbacks.onMetricStripJumpEnd?.();
        return true;
    }

    // Reset zoom (0/Escape)
    if (key === '0' || event.key === 'Escape') {
      this.callbacks.onMetricStripResetZoom?.();
      return true;
    }

    return false;
  }

  /**
   * Handle arrow keys for metric strip pan.
   * - Left/Right: Pan viewport horizontally
   * - Up/Down: Pan depth vertically
   */
  private handleMetricStripPanKeys(event: KeyboardEvent): boolean {
    const viewportState = this.viewport.getState();

    // Calculate pan step (5% of visible range, matching main timeline and minimap)
    const horizontalStep = viewportState.displayWidth * KEYBOARD_CONSTANTS.panStepPercent;
    const verticalStep = viewportState.displayHeight * KEYBOARD_CONSTANTS.panStepPercent;

    switch (event.key) {
      case 'ArrowLeft':
        // Pan viewport left - convert pixels to time
        this.callbacks.onMetricStripPanViewport?.(-horizontalStep / viewportState.zoom);
        return true;
      case 'ArrowRight':
        // Pan viewport right - convert pixels to time
        this.callbacks.onMetricStripPanViewport?.(horizontalStep / viewportState.zoom);
        return true;
      case 'ArrowUp':
        // Pan depth up (show deeper frames)
        this.callbacks.onMetricStripPanDepth?.(-verticalStep);
        return true;
      case 'ArrowDown':
        // Pan depth down (show shallower frames)
        this.callbacks.onMetricStripPanDepth?.(verticalStep);
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle keyup events.
   */
  private handleKeyUp(_event: KeyboardEvent): void {
    // No-op - reserved for future use
  }

  /**
   * Handle pan keys.
   * - Shift + Arrow keys: Always pan (even when frame/marker selected)
   * - Arrow keys without Shift: Marker navigation first (if marker selected),
   *   then frame navigation, otherwise falls through to pan
   * - A/D: Horizontal pan (left/right)
   * @returns true if event was handled
   */
  private handlePanKeys(event: KeyboardEvent): boolean {
    const viewportState = this.viewport.getState();
    const stepX = viewportState.displayWidth * KEYBOARD_CONSTANTS.panStepPercent;
    const stepY = viewportState.displayHeight * KEYBOARD_CONSTANTS.panStepPercent;

    // A/D keys for horizontal pan (always work, regardless of Shift)
    if (event.key === 'a' || event.key === 'A') {
      this.callbacks.onPan?.(-stepX, 0);
      return true;
    }
    if (event.key === 'd' || event.key === 'D') {
      this.callbacks.onPan?.(stepX, 0);
      return true;
    }

    // Arrow keys: Try marker navigation first (unless Shift is held)
    // Markers only support left/right navigation
    if (!event.shiftKey && this.callbacks.onMarkerNav) {
      let markerDirection: MarkerNavDirection | null = null;
      switch (event.key) {
        case 'ArrowLeft':
          markerDirection = 'left';
          break;
        case 'ArrowRight':
          markerDirection = 'right';
          break;
      }

      if (markerDirection !== null) {
        const handled = this.callbacks.onMarkerNav(markerDirection);
        if (handled) {
          return true;
        }
        // Fall through to frame nav or pan if marker nav didn't handle it
      }
    }

    // Arrow keys: Try frame navigation (unless Shift is held)
    // If onFrameNav returns true, navigation was handled; otherwise fall through to pan
    if (!event.shiftKey && this.callbacks.onFrameNav) {
      let direction: FrameNavDirection | null = null;
      switch (event.key) {
        case 'ArrowUp':
          direction = 'up';
          break;
        case 'ArrowDown':
          direction = 'down';
          break;
        case 'ArrowLeft':
          direction = 'left';
          break;
        case 'ArrowRight':
          direction = 'right';
          break;
      }

      if (direction !== null) {
        const handled = this.callbacks.onFrameNav(direction);
        if (handled) {
          return true;
        }
        // Fall through to pan if frame nav didn't handle it
      }
    }

    // Arrow keys: pan when Shift is held OR when frame nav didn't handle it
    switch (event.key) {
      case 'ArrowLeft':
        this.callbacks.onPan?.(-stepX, 0);
        return true;
      case 'ArrowRight':
        this.callbacks.onPan?.(stepX, 0);
        return true;
      case 'ArrowUp':
        this.callbacks.onPan?.(0, -stepY);
        return true;
      case 'ArrowDown':
        this.callbacks.onPan?.(0, stepY);
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle zoom keys (W / S / + / - / =).
   * Shift + W/S = vertical pan (consistent with Shift + wheel behavior).
   * @returns true if event was handled
   */
  private handleZoomKeys(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();

    // Shift + W/S = vertical pan (up/down through stack depth)
    if (event.shiftKey && (key === 'w' || key === 's')) {
      const viewportState = this.viewport.getState();
      const stepY = viewportState.displayHeight * KEYBOARD_CONSTANTS.panStepPercent;
      const deltaY = key === 'w' ? -stepY : stepY;
      this.callbacks.onPan?.(0, deltaY);
      return true;
    }

    switch (key) {
      case 'w':
      case '+':
      case '=':
        this.callbacks.onZoom?.('in');
        return true;
      case 's':
      case '-':
        this.callbacks.onZoom?.('out');
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle reset zoom keys (Home / 0).
   * @returns true if event was handled
   */
  private handleResetKeys(event: KeyboardEvent): boolean {
    // Don't handle if Ctrl/Alt/Meta is pressed (allow browser shortcuts)
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    switch (event.key) {
      case 'Home':
      case '0':
        this.callbacks.onResetZoom?.();
        return true;
      default:
        return false;
    }
  }

  /**
   * Handle Escape key (cancel/deselect).
   * @returns true if event was handled
   */
  private handleEscapeKey(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.callbacks.onEscape?.();
      return true;
    }
    return false;
  }

  /**
   * Handle J key (Jump to Call Tree).
   * Navigates call tree to currently selected frame.
   * @returns true if event was handled
   */
  private handleJumpKey(event: KeyboardEvent): boolean {
    // Don't handle if modifier keys are pressed (allow browser shortcuts)
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    if (event.key === 'j' || event.key === 'J') {
      this.callbacks.onJumpToCallTree?.();
      return true;
    }
    return false;
  }

  /**
   * Handle Enter/Z keys (Focus - zoom to fit selected frame).
   * @returns true if event was handled
   */
  private handleFocusKeys(event: KeyboardEvent): boolean {
    // Don't handle if modifier keys are pressed (allow browser shortcuts)
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    if (event.key === 'Enter' || event.key === 'z' || event.key === 'Z') {
      this.callbacks.onFocus?.();
      return true;
    }
    return false;
  }

  /**
   * Handle Ctrl/Cmd+C key (Copy selected frame name).
   * @returns true if event was handled
   */
  private handleCopyKey(event: KeyboardEvent): boolean {
    // Only handle Ctrl+C (Windows/Linux) or Cmd+C (Mac)
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    if (!isCtrlOrCmd || event.altKey) {
      return false;
    }

    if (event.key === 'c' || event.key === 'C') {
      this.callbacks.onCopy?.();
      return true;
    }
    return false;
  }
}
