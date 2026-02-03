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
 * - Cmd/Ctrl+click: Teleport lens to click position (preserving width)
 * - Wheel vertical: Zoom both views at cursor
 * - Wheel horizontal: Pan selection
 * - Double-click: Reset view (zoom to fit full timeline)
 * - Hover: Show vertical guide on other view (cursor mirror)
 */

import { HEAT_STRIP_HIT_HEIGHT } from './HeatStripRenderer.js';
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

  /**
   * Called when user hovers over the heat strip area.
   * @param timeNs - Time position being hovered, or null when leaving
   * @param screenX - Screen X coordinate for tooltip positioning
   * @param screenY - Screen Y coordinate for tooltip positioning
   */
  onHeatStripHover?: (timeNs: number | null, screenX: number, screenY: number) => void;

  /**
   * Called when user clicks on the heat strip area.
   * @param timeNs - Time position clicked
   */
  onHeatStripClick?: (timeNs: number) => void;
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

  // Saved selection for restoring on click without drag (prevents ew-resize cursor bug)
  private savedSelectionStart = 0;
  private savedSelectionEnd = 0;

  // Track last known mouse position for cursor updates on key changes
  private lastMouseX = 0;
  private lastMouseY = 0;
  private isMouseInMinimap = false;

  // Double-click detection
  private lastClickTime = 0;
  private lastClickX = 0;
  private lastClickY = 0;

  // Heat strip hover state
  private isInHeatStrip = false;

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

    // Keydown/keyup handlers for cursor updates when Shift/Cmd/Ctrl changes
    const keyDownHandler = this.handleKeyDown.bind(this) as (e: Event) => void;
    const keyUpHandler = this.handleKeyUp.bind(this) as (e: Event) => void;
    document.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keyup', keyUpHandler);
    this.boundHandlers.set('keydown', keyDownHandler);
    this.boundHandlers.set('keyup', keyUpHandler);
  }

  private detachEventListeners(): void {
    // Ensure global mousemove is detached if still active
    this.detachGlobalMouseMove();

    for (const [key, handler] of this.boundHandlers) {
      if (key === 'global-mouseup') {
        document.removeEventListener('mouseup', handler);
      } else if (key === 'keydown') {
        document.removeEventListener('keydown', handler);
      } else if (key === 'keyup') {
        document.removeEventListener('keyup', handler);
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
   * Handle mouse down - start drag operation or teleport.
   *
   * Interaction behavior:
   * - Cmd/Ctrl+click: Teleport lens to click position (no drag)
   * - Default drag anywhere: Create new zoom area selection
   * - Shift + drag inside lens: Move existing viewport
   * - Drag on top edge of lens: Move existing viewport
   * - Drag on left/right edge: Resize
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

    // Heat strip click: set isDragging but skip drag mode setup
    // This allows mouseUp to handle the heat strip click via existing code
    if (this.isInHeatStripArea(screenY)) {
      this.isDragging = true;
      this.didDrag = false;
      return;
    }

    this.mouseDownX = event.clientX;
    this.mouseDownY = event.clientY;
    this.didDrag = false;
    this.didPositionDepth = false;

    // Save current selection (for restoring on click without drag)
    const currentSelection = this.manager.getSelection();
    this.savedSelectionStart = currentSelection.startTime;
    this.savedSelectionEnd = currentSelection.endTime;

    // Cmd/Ctrl+click = teleport lens, then start move mode if still holding
    if (event.metaKey || event.ctrlKey) {
      this.teleportLensToPosition(screenX);
      // Start move mode for continued dragging after teleport
      this.dragMode = 'move';
      this.shiftKeyHeld = false;
      this.isDragging = true;
      this.attachGlobalMouseMove();
      this.dragStartX = screenX;
      this.dragStartY = screenY;
      this.lastDragY = screenY;
      this.dragStartTime = this.manager.minimapXToTime(screenX);
      this.lastDragTime = this.dragStartTime;
      this.manager.startDrag(this.dragMode);
      this.updateCursor(this.dragMode, false, true, false);
      return;
    }

    // Track Shift key state
    this.shiftKeyHeld = event.shiftKey;

    // Determine drag mode based on position AND modifier keys
    // Pass screenY to enable top edge detection
    this.dragMode = this.manager.getDragModeForPosition(screenX, this.shiftKeyHeld, screenY);
    this.isDragging = true;
    this.attachGlobalMouseMove(); // Track mouse even outside canvas
    this.dragStartX = screenX;
    this.dragStartY = screenY; // Track Y for depth panning
    this.lastDragY = screenY;
    this.dragStartTime = this.manager.minimapXToTime(screenX);
    this.lastDragTime = this.dragStartTime; // Track for continuous X panning

    // Store anchor for resize operations
    if (this.dragMode === 'resize-left') {
      this.dragAnchorTime = currentSelection.endTime;
    } else if (this.dragMode === 'resize-right') {
      this.dragAnchorTime = currentSelection.startTime;
    }

    // For create mode, start selection at current position
    // Note: depth positioning happens when drag actually starts (past threshold)
    if (this.dragMode === 'create') {
      this.manager.setSelection(this.dragStartTime, this.dragStartTime);
    }

    this.manager.startDrag(this.dragMode);
    this.updateCursor(this.dragMode, false, true, this.shiftKeyHeld);
  }

  /**
   * Check if a Y coordinate is within the heat strip area.
   * Hit area extends above and below the visual heat strip for easier targeting.
   */
  private isInHeatStripArea(screenY: number): boolean {
    const minimapHeight = this.manager.getHeight();
    // Use larger hit area for easier mouse targeting (extends above and below)
    const heatStripTop = minimapHeight - HEAT_STRIP_HIT_HEIGHT;
    // Extend hit area 5px below minimap bottom edge for bottom-edge targeting
    const heatStripBottom = minimapHeight + 5;
    return screenY >= heatStripTop && screenY <= heatStripBottom;
  }

  /**
   * Handle mouse move - update drag or cursor.
   */
  private handleMouseMove(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    // Track mouse position for key event cursor updates
    this.lastMouseX = screenX;
    this.lastMouseY = screenY;

    // Only handle if within minimap height (unless dragging)
    if (screenY > this.manager.getHeight() && !this.isDragging) {
      // Cursor left minimap area
      this.isMouseInMinimap = false;
      this.handleHeatStripLeave();
      this.callbacks.onCursorMove(null);
      this.canvas.style.cursor = 'default';
      return;
    }

    this.isMouseInMinimap = true;

    // Always update cursor mirror when in minimap
    const cursorTime = this.manager.minimapXToTime(screenX);
    this.callbacks.onCursorMove(cursorTime);

    // Check for heat strip hover (only when not dragging)
    if (!this.isDragging) {
      const inHeatStrip = this.isInHeatStripArea(screenY);
      if (inHeatStrip !== this.isInHeatStrip) {
        this.isInHeatStrip = inHeatStrip;
        if (!inHeatStrip) {
          this.handleHeatStripLeave();
        }
      }
      if (inHeatStrip) {
        this.callbacks.onHeatStripHover?.(cursorTime, screenX, screenY);
        // Change cursor to pointer for clickable heat strip
        this.canvas.style.cursor = 'pointer';
        return;
      }
    }

    if (this.isDragging) {
      // Hide heat strip tooltip during drag
      if (this.isInHeatStrip) {
        this.isInHeatStrip = false;
        this.handleHeatStripLeave();
      }

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
      // Update cursor based on position and modifier keys
      // Pass screenY to enable top edge detection for grab cursor
      const mode = this.manager.getDragModeForPosition(screenX, event.shiftKey, screenY);
      this.updateCursor(mode, event.metaKey || event.ctrlKey, false, event.shiftKey);
    }
  }

  /**
   * Handle heat strip leave (hide tooltip).
   */
  private handleHeatStripLeave(): void {
    this.callbacks.onHeatStripHover?.(null, 0, 0);
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

    // Update cursor during drag (use current drag mode, not position-based mode)
    if (this.dragMode) {
      this.updateCursor(this.dragMode, false, true, shiftKey);
    }
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

    // Save drag mode before ending drag (needed for selection restoration)
    const wasCreateMode = this.dragMode === 'create';

    this.endDrag();

    // Check for double-click or single click (if no drag occurred)
    if (!this.didDrag) {
      // Restore original selection if this was create mode without actual drag
      // This prevents the zero-width selection from affecting cursor calculation
      if (wasCreateMode) {
        this.manager.setSelection(this.savedSelectionStart, this.savedSelectionEnd);
        this.callbacks.onSelectionChange(this.savedSelectionStart, this.savedSelectionEnd);
      }

      // Check for heat strip click
      if (this.isInHeatStripArea(screenY)) {
        const clickTime = this.manager.minimapXToTime(screenX);
        this.callbacks.onHeatStripClick?.(clickTime);
        // Don't process as regular click
        return;
      }

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
        // Single click - teleport lens to clicked position
        this.teleportLensToPosition(screenX);

        // Record for potential double-click
        this.lastClickTime = currentTime;
        this.lastClickX = screenX;
        this.lastClickY = screenY;
      }
    }

    // Update cursor based on position after drag ends
    const mode = this.manager.getDragModeForPosition(screenX, event.shiftKey, screenY);
    this.updateCursor(mode, event.metaKey || event.ctrlKey, false, event.shiftKey);
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
      this.isMouseInMinimap = false;
      this.handleHeatStripLeave();
      this.callbacks.onCursorMove(null);
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Handle keydown - update cursor when modifier keys change.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Only update cursor if mouse is in minimap and not dragging
    if (!this.isMouseInMinimap || this.isDragging) {
      return;
    }

    // Update cursor when Shift, Cmd, or Ctrl is pressed
    if (event.key === 'Shift' || event.key === 'Meta' || event.key === 'Control') {
      const mode = this.manager.getDragModeForPosition(
        this.lastMouseX,
        event.shiftKey,
        this.lastMouseY,
      );
      this.updateCursor(mode, event.metaKey || event.ctrlKey, false, event.shiftKey);
    }
  }

  /**
   * Handle keyup - update cursor when modifier keys change.
   */
  private handleKeyUp(event: KeyboardEvent): void {
    // Only update cursor if mouse is in minimap and not dragging
    if (!this.isMouseInMinimap || this.isDragging) {
      return;
    }

    // Update cursor when Shift, Cmd, or Ctrl is released
    if (event.key === 'Shift' || event.key === 'Meta' || event.key === 'Control') {
      const mode = this.manager.getDragModeForPosition(
        this.lastMouseX,
        event.shiftKey,
        this.lastMouseY,
      );
      this.updateCursor(mode, event.metaKey || event.ctrlKey, false, event.shiftKey);
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
   * Teleport lens to center on a screen X position, preserving current width.
   * Clamps to timeline bounds while maintaining lens width.
   */
  private teleportLensToPosition(screenX: number): void {
    const selection = this.manager.getSelection();
    const clickTime = this.manager.minimapXToTime(screenX);
    const duration = selection.endTime - selection.startTime;
    const halfDuration = duration / 2;

    // Calculate new bounds centered on click
    let newStart = clickTime - halfDuration;
    let newEnd = clickTime + halfDuration;

    // Clamp to timeline bounds while maintaining width
    const totalDuration = this.manager.getState().totalDuration;
    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(duration, totalDuration);
    } else if (newEnd > totalDuration) {
      newEnd = totalDuration;
      newStart = Math.max(0, totalDuration - duration);
    }

    this.manager.setSelection(newStart, newEnd);
    this.callbacks.onSelectionChange(newStart, newEnd);
  }

  /**
   * Update cursor style based on drag mode and modifier keys.
   *
   * Cursor states:
   * - Cmd/Ctrl held (teleport ready): pointer
   * - Shift held (pan ready): grab
   * - Shift + click/drag (panning): grabbing
   * - Hover left/right edge: ew-resize
   * - Hover top edge of lens: grab
   * - Dragging top edge: grabbing
   * - Creating/dragging selection: crosshair
   * - Default: crosshair
   *
   * @param mode - The drag mode based on position
   * @param metaKey - Whether Cmd/Ctrl is held
   * @param isDraggingNow - Whether currently in active drag
   * @param shiftKey - Whether Shift is held
   */
  private updateCursor(
    mode: MinimapDragMode,
    metaKey = false,
    isDraggingNow = false,
    shiftKey = false,
  ): void {
    // Cmd/Ctrl held shows pointer for teleport action (only when not dragging)
    if (metaKey && !isDraggingNow) {
      this.canvas.style.cursor = 'pointer';
      return;
    }

    // Shift key handling: grab when hovering, grabbing when clicking/dragging
    // This applies when shift turns 'create' mode into 'move' mode
    if (shiftKey) {
      this.canvas.style.cursor = isDraggingNow ? 'grabbing' : 'grab';
      return;
    }

    switch (mode) {
      case 'resize-left':
      case 'resize-right':
        this.canvas.style.cursor = 'ew-resize';
        break;
      case 'move':
        // Move mode (top edge or after teleport): grab when hovering, grabbing when dragging
        this.canvas.style.cursor = isDraggingNow ? 'grabbing' : 'grab';
        break;
      case 'create':
        this.canvas.style.cursor = 'crosshair';
        break;
      default:
        this.canvas.style.cursor = 'crosshair';
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
