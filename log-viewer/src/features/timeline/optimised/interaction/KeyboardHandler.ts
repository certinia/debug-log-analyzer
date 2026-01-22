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
  /** Delay before showing shortcut hints overlay (ms) */
  shiftHintDelay: 500,
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

  /** Called when Shift key hold state changes (for hints overlay). */
  onShiftHeld?: (held: boolean) => void;

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
  private shiftHintTimeout: ReturnType<typeof setTimeout> | null = null;
  private isShiftHeld = false;

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
    this.clearShiftHintTimeout();
    this.isAttached = false;
  }

  /**
   * Clean up all resources.
   */
  public destroy(): void {
    this.detach();
    this.clearShiftHintTimeout();
  }

  /**
   * Handle keydown events.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Track Shift key for hints overlay
    if (event.key === 'Shift' && !this.isShiftHeld) {
      this.isShiftHeld = true;
      this.startShiftHintTimeout();
    }

    // Determine action based on key combination
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
   * Handle keyup events.
   */
  private handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      this.isShiftHeld = false;
      this.clearShiftHintTimeout();
      this.callbacks.onShiftHeld?.(false);
    }
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

  /**
   * Start timeout for showing shift hints overlay.
   */
  private startShiftHintTimeout(): void {
    this.clearShiftHintTimeout();
    this.shiftHintTimeout = setTimeout(() => {
      if (this.isShiftHeld) {
        this.callbacks.onShiftHeld?.(true);
      }
    }, KEYBOARD_CONSTANTS.shiftHintDelay);
  }

  /**
   * Clear shift hint timeout.
   */
  private clearShiftHintTimeout(): void {
    if (this.shiftHintTimeout !== null) {
      clearTimeout(this.shiftHintTimeout);
      this.shiftHintTimeout = null;
    }
  }
}
