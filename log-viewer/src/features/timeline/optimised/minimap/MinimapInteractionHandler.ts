/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapInteractionHandler
 *
 * Handles mouse/touch input on the minimap for viewport navigation.
 * Follows existing TimelineInteractionHandler patterns.
 *
 * Interactions:
 * - Click+drag on minimap: Create selection → zoom main timeline to selection
 * - Drag inside lens: Move viewport horizontally
 * - Drag edge handles: Expand/contract zoom range
 * - Wheel vertical: Zoom both views at cursor
 * - Wheel horizontal: Pan selection
 * - Double-click: Reset view (zoom to fit full timeline)
 * - Hover: Show vertical guide on other view (cursor mirror)
 */

import type { MinimapDragMode, MinimapManager } from './MinimapManager.js';

/**
 * Callbacks for minimap interaction events.
 */
export interface MinimapInteractionCallbacks {
  /** Called when selection changes (user creates/moves/resizes selection). */
  onSelectionChange: (startTime: number, endTime: number) => void;

  /** Called when user zooms via wheel. Factor > 1 = zoom in. */
  onZoom: (factor: number, anchorTimeNs: number) => void;

  /** Called on double-click to reset view. */
  onResetView: () => void;

  /** Called when cursor moves over minimap (for cursor mirror). Null when leaving. */
  onCursorMove: (timeNs: number | null) => void;

  /**
   * Called when horizontal wheel/swipe pans the selection.
   * Receives raw pixel delta to allow main viewport zoom-based conversion.
   * This ensures minimap pan feels the same speed as main timeline pan.
   */
  onHorizontalPan?: (deltaPixels: number) => void;

  /** Called when Y drag during move mode pans the depth viewport. */
  onDepthPan?: (deltaY: number) => void;

  /**
   * Called when 'create' drag starts to position lens at initial Y.
   * @param minimapY - Y coordinate in minimap where drag started
   */
  onDepthPositionStart?: (minimapY: number) => void;
}

/**
 * Drag threshold - movement required to count as drag vs click.
 */
const DRAG_THRESHOLD = 3;

/**
 * Double-click detection thresholds.
 */
const DOUBLE_CLICK_THRESHOLD_MS = 300;
const DOUBLE_CLICK_DISTANCE = 5;

export class MinimapInteractionHandler {
  private canvas: HTMLCanvasElement;
  private manager: MinimapManager;
  private callbacks: MinimapInteractionCallbacks;

  // Drag state
  private isDragging = false;
  private dragMode: MinimapDragMode | null = null;
  private dragStartX = 0;
  private dragStartY = 0; // Track Y for depth panning during move
  private dragStartTime = 0;
  private dragAnchorTime = 0; // For resize: the fixed edge time
  private lastDragY = 0; // Track last Y position for continuous Y panning
  private lastDragTime = 0; // Track last time position for continuous X panning

  // Track if actual drag occurred (vs just a click)
  private didDrag = false;
  private didPositionDepth = false; // Track if initial depth positioning was done for create mode
  private mouseDownX = 0;
  private mouseDownY = 0;

  // Modifier key state
  private shiftKeyHeld = false;

  // Double-click detection
  private lastClickTime = 0;
  private lastClickX = 0;
  private lastClickY = 0;

  // Event listener references for cleanup
  private boundHandlers: Map<string, (e: Event) => void> = new Map();

  constructor(
    canvas: HTMLCanvasElement,
    manager: MinimapManager,
    callbacks: MinimapInteractionCallbacks,
  ) {
    this.canvas = canvas;
    this.manager = manager;
    this.callbacks = callbacks;

    this.attachEventListeners();
  }

  /**
   * Clean up event listeners.
   */
  public destroy(): void {
    this.detachEventListeners();
  }

  // ============================================================================
  // EVENT LISTENER SETUP
  // ============================================================================

  private attachEventListeners(): void {
    const wheelHandler = this.handleWheel.bind(this) as (e: Event) => void;
    const mouseDownHandler = this.handleMouseDown.bind(this) as (e: Event) => void;
    const mouseMoveHandler = this.handleMouseMove.bind(this) as (e: Event) => void;
    const mouseUpHandler = this.handleMouseUp.bind(this) as (e: Event) => void;
    const mouseLeaveHandler = this.handleMouseLeave.bind(this) as (e: Event) => void;

    this.canvas.addEventListener('wheel', wheelHandler, { passive: false });
    this.canvas.addEventListener('mousedown', mouseDownHandler);
    this.canvas.addEventListener('mousemove', mouseMoveHandler);
    this.canvas.addEventListener('mouseup', mouseUpHandler);
    this.canvas.addEventListener('mouseleave', mouseLeaveHandler);

    this.boundHandlers.set('wheel', wheelHandler);
    this.boundHandlers.set('mousedown', mouseDownHandler);
    this.boundHandlers.set('mousemove', mouseMoveHandler);
    this.boundHandlers.set('mouseup', mouseUpHandler);
    this.boundHandlers.set('mouseleave', mouseLeaveHandler);

    // Global mouseup to handle drag release outside canvas
    const globalMouseUpHandler = this.handleGlobalMouseUp.bind(this) as (e: Event) => void;
    document.addEventListener('mouseup', globalMouseUpHandler);
    this.boundHandlers.set('global-mouseup', globalMouseUpHandler);

    // Store global mousemove handler for dynamic attach/detach during drag
    const globalMouseMoveHandler = this.handleGlobalMouseMove.bind(this) as (e: Event) => void;
    this.boundHandlers.set('global-mousemove', globalMouseMoveHandler);
  }

  private detachEventListeners(): void {
    // Ensure global mousemove is detached if still active
    this.detachGlobalMouseMove();

    for (const [key, handler] of this.boundHandlers) {
      if (key === 'global-mouseup') {
        document.removeEventListener('mouseup', handler);
      } else if (key !== 'global-mousemove') {
        // Skip global-mousemove, it's managed dynamically
        this.canvas.removeEventListener(key, handler);
      }
    }
    this.boundHandlers.clear();
  }

  private attachGlobalMouseMove(): void {
    const handler = this.boundHandlers.get('global-mousemove');
    if (handler) {
      document.addEventListener('mousemove', handler);
    }
  }

  private detachGlobalMouseMove(): void {
    const handler = this.boundHandlers.get('global-mousemove');
    if (handler) {
      document.removeEventListener('mousemove', handler);
    }
  }

  /**
   * Handle global mouse move during drag (when mouse is outside canvas).
   */
  private handleGlobalMouseMove(event: MouseEvent): void {
    if (!this.isDragging) {
      return;
    }

    // Check if mouse button was released outside the window
    // (mouseup doesn't fire when released outside browser)
    if (event.buttons === 0) {
      this.endDrag();
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    // Check drag threshold
    if (!this.didDrag) {
      const distance = Math.max(
        Math.abs(event.clientX - this.mouseDownX),
        Math.abs(event.clientY - this.mouseDownY),
      );
      if (distance >= DRAG_THRESHOLD) {
        this.didDrag = true;
      } else {
        return;
      }
    }

    const currentTime = this.manager.minimapXToTime(screenX);
    this.handleDrag(currentTime, screenY, event.shiftKey);
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  /**
   * Handle wheel event for zoom and pan.
   */
  private handleWheel(event: WheelEvent): void {
    // Only handle if event is within minimap height
    const rect = this.canvas.getBoundingClientRect();
    const screenY = event.clientY - rect.top;
    if (screenY > this.manager.getHeight()) {
      return; // Not in minimap area, let it propagate
    }

    event.preventDefault();
    event.stopPropagation();

    const screenX = event.clientX - rect.left;
    const anchorTimeNs = this.manager.minimapXToTime(screenX);

    // Horizontal scroll = pan
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      if (this.callbacks.onHorizontalPan) {
        // Use callback to convert using main viewport zoom (matches main timeline pan speed)
        this.callbacks.onHorizontalPan(event.deltaX);
      } else {
        // Fallback: convert using minimap scale
        const deltaTime =
          this.manager.minimapXToTime(event.deltaX) - this.manager.minimapXToTime(0);
        this.manager.moveSelection(deltaTime);
        const selection = this.manager.getSelection();
        this.callbacks.onSelectionChange(selection.startTime, selection.endTime);
      }
      return;
    }

    // Vertical scroll = zoom
    const zoomDelta = -event.deltaY;
    const normalizedDelta = event.deltaMode === 1 ? zoomDelta * 15 : zoomDelta;
    const zoomFactor = 1 + normalizedDelta * 0.001;

    this.callbacks.onZoom(zoomFactor, anchorTimeNs);
  }

  /**
   * Handle mouse down - start drag operation.
   *
   * Interaction behavior:
   * - Default drag anywhere: Create new zoom area selection
   * - Shift + drag inside lens: Move existing viewport
   * - Drag on edge: Resize (unchanged)
   */
  private handleMouseDown(event: MouseEvent): void {
    if (event.button !== 0) {
      return; // Only left button
    }

    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    // Only handle if within minimap height
    if (screenY > this.manager.getHeight()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    this.mouseDownX = event.clientX;
    this.mouseDownY = event.clientY;
    this.didDrag = false;
    this.didPositionDepth = false;

    // Track Shift key state
    this.shiftKeyHeld = event.shiftKey;

    // Determine drag mode based on position AND modifier keys
    // - Shift+drag inside lens = move viewport
    // - Default drag inside lens = create new selection
    this.dragMode = this.manager.getDragModeForPosition(screenX, this.shiftKeyHeld);
    this.isDragging = true;
    this.attachGlobalMouseMove(); // Track mouse even outside canvas
    this.dragStartX = screenX;
    this.dragStartY = screenY; // Track Y for depth panning
    this.lastDragY = screenY;
    this.dragStartTime = this.manager.minimapXToTime(screenX);
    this.lastDragTime = this.dragStartTime; // Track for continuous X panning

    // Store anchor for resize operations
    const selection = this.manager.getSelection();
    if (this.dragMode === 'resize-left') {
      this.dragAnchorTime = selection.endTime;
    } else if (this.dragMode === 'resize-right') {
      this.dragAnchorTime = selection.startTime;
    }

    // For create mode, start selection at current position
    // Note: depth positioning happens when drag actually starts (past threshold)
    if (this.dragMode === 'create') {
      this.manager.setSelection(this.dragStartTime, this.dragStartTime);
    }

    this.manager.startDrag(this.dragMode);
    this.updateCursor(this.dragMode);
  }

  /**
   * Handle mouse move - update drag or cursor.
   */
  private handleMouseMove(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    // Only handle if within minimap height (unless dragging)
    if (screenY > this.manager.getHeight() && !this.isDragging) {
      // Cursor left minimap area
      this.callbacks.onCursorMove(null);
      this.canvas.style.cursor = 'default';
      return;
    }

    // Always update cursor mirror when in minimap
    const cursorTime = this.manager.minimapXToTime(screenX);
    this.callbacks.onCursorMove(cursorTime);

    if (this.isDragging) {
      // Check if we've moved enough to count as drag
      if (!this.didDrag) {
        const distance = Math.max(
          Math.abs(event.clientX - this.mouseDownX),
          Math.abs(event.clientY - this.mouseDownY),
        );
        if (distance >= DRAG_THRESHOLD) {
          this.didDrag = true;

          // For create mode, position lens at initial Y when drag actually starts
          if (this.dragMode === 'create' && !this.didPositionDepth) {
            this.didPositionDepth = true;
            this.callbacks.onDepthPositionStart?.(this.dragStartY);
          }
        } else {
          return;
        }
      }

      const currentTime = this.manager.minimapXToTime(screenX);
      this.handleDrag(currentTime, screenY, event.shiftKey);
    } else {
      // Update cursor based on position and current Shift state
      // Show grab cursor when Shift is held over lens, crosshair otherwise
      const mode = this.manager.getDragModeForPosition(screenX, event.shiftKey);
      this.updateCursor(mode);
    }
  }

  /**
   * Handle drag update based on current mode.
   *
   * @param currentTime - Current X position as time in nanoseconds
   * @param screenY - Current Y position in screen coordinates (for depth panning)
   * @param shiftKey - Whether Shift key is currently held
   */
  private handleDrag(currentTime: number, screenY: number, shiftKey: boolean): void {
    switch (this.dragMode) {
      case 'create': {
        if (shiftKey) {
          // Shift held: pause sizing, pan X instead
          const deltaTime = currentTime - this.lastDragTime;
          this.manager.moveSelection(deltaTime);
          // Also move the anchor so sizing resumes correctly after releasing Shift
          this.dragStartTime += deltaTime;
        } else {
          // No Shift: continue sizing the selection (X direction)
          this.manager.setSelection(this.dragStartTime, currentTime);
        }

        // Y direction: always pan depth viewport during drag
        const deltaY = screenY - this.lastDragY;
        if (deltaY !== 0 && this.callbacks.onDepthPan) {
          this.callbacks.onDepthPan(deltaY);
        }

        // Always update for smooth transitions
        this.lastDragTime = currentTime;
        this.lastDragY = screenY;
        break;
      }

      case 'move': {
        // Move selection by delta (X direction)
        const deltaTime = currentTime - this.dragStartTime;
        this.manager.moveSelection(deltaTime);
        // Update drag start for continuous movement
        this.dragStartTime = currentTime;

        // Handle Y direction: pan depth viewport
        // Y drag during Shift+move scrolls main viewport vertically
        const deltaY = screenY - this.lastDragY;
        if (deltaY !== 0 && this.callbacks.onDepthPan) {
          this.callbacks.onDepthPan(deltaY);
        }
        this.lastDragY = screenY;
        break;
      }

      case 'resize-left':
      case 'resize-right': {
        // Both resize modes use the same logic - anchor is the opposite edge
        if (shiftKey) {
          // Shift held: pause resizing, pan X instead
          const deltaTime = currentTime - this.lastDragTime;
          this.manager.moveSelection(deltaTime);
          // Update anchor so resizing resumes correctly after releasing Shift
          this.dragAnchorTime += deltaTime;
        } else {
          // No Shift: resize from anchor to current position (edges can cross)
          this.manager.setSelection(this.dragAnchorTime, currentTime);
        }

        // Y direction: always pan depth viewport during drag
        const deltaY = screenY - this.lastDragY;
        if (deltaY !== 0 && this.callbacks.onDepthPan) {
          this.callbacks.onDepthPan(deltaY);
        }

        // Always update for smooth transitions
        this.lastDragTime = currentTime;
        this.lastDragY = screenY;
        break;
      }
    }

    // Notify selection change
    const selection = this.manager.getSelection();
    this.callbacks.onSelectionChange(selection.startTime, selection.endTime);
  }

  /**
   * Handle mouse up - end drag or detect click/double-click.
   */
  private handleMouseUp(event: MouseEvent): void {
    if (!this.isDragging) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    this.endDrag();

    // Check for double-click (if no drag occurred)
    if (!this.didDrag) {
      const currentTime = Date.now();
      const timeSinceLastClick = currentTime - this.lastClickTime;
      const distanceX = Math.abs(screenX - this.lastClickX);
      const distanceY = Math.abs(screenY - this.lastClickY);
      const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

      if (timeSinceLastClick < DOUBLE_CLICK_THRESHOLD_MS && distance < DOUBLE_CLICK_DISTANCE) {
        // Double-click detected - reset view
        this.callbacks.onResetView();
        this.lastClickTime = 0;
      } else {
        // Single click - record for potential double-click
        this.lastClickTime = currentTime;
        this.lastClickX = screenX;
        this.lastClickY = screenY;

        // For single click in create mode with no drag, zoom to that point
        // (Skip this - it's not in the spec, just a thought)
      }
    }

    // Update cursor
    const mode = this.manager.getDragModeForPosition(screenX);
    this.updateCursor(mode);
  }

  /**
   * Handle global mouse up (when mouse is released outside canvas).
   */
  private handleGlobalMouseUp(_event: MouseEvent): void {
    if (this.isDragging) {
      this.endDrag();
    }
  }

  /**
   * Handle mouse leave - update cursor mirror.
   */
  private handleMouseLeave(_event: MouseEvent): void {
    if (!this.isDragging) {
      this.callbacks.onCursorMove(null);
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * End drag operation.
   */
  private endDrag(): void {
    this.isDragging = false;
    this.dragMode = null;
    this.detachGlobalMouseMove(); // Stop tracking mouse outside canvas
    this.manager.endDrag();
  }

  /**
   * Update cursor style based on drag mode.
   */
  private updateCursor(mode: MinimapDragMode): void {
    switch (mode) {
      case 'resize-left':
      case 'resize-right':
        this.canvas.style.cursor = 'ew-resize';
        break;
      case 'move':
        this.canvas.style.cursor = this.isDragging ? 'grabbing' : 'grab';
        break;
      case 'create':
        this.canvas.style.cursor = 'crosshair';
        break;
      default:
        this.canvas.style.cursor = 'default';
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Check if a screen Y coordinate is within the minimap area.
   *
   * @param screenY - Y coordinate relative to canvas
   * @returns true if within minimap height
   */
  public isInMinimapArea(screenY: number): boolean {
    return screenY >= 0 && screenY <= this.manager.getHeight();
  }

  /**
   * Get minimap height for layout calculations.
   */
  public getHeight(): number {
    return this.manager.getHeight();
  }
}
