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
}

/**
 * Handles keyboard input for flame chart navigation.
 *
 * Key Mappings:
 * - W / + / = : Zoom in
 * - S / - : Zoom out
 * - A : Pan left
 * - D : Pan right
 * - Arrow keys (no modifier): Pan in direction (when no frame selected)
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
   * - Shift + Arrow keys: Always pan (even when frame selected)
   * - Arrow keys without Shift: Pan (Phase 2 will change this to frame navigation when selected)
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

    // Arrow keys: pan when Shift is held OR when no frame is selected
    // Phase 2 will add: if (!shiftKey && hasSelectedFrame) return false; // let frame nav handle it
    // For now, arrows always pan

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
   * Works regardless of Shift key state.
   * @returns true if event was handled
   */
  private handleZoomKeys(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();

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
