/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * TimelineInteractionHandler
 *
 * Handles user interactions (wheel, mouse, keyboard) for timeline navigation.
 * Manages zoom (wheel), pan (drag), and event selection.
 */

import type { TimelineViewport } from '../TimelineViewport.js';

/**
 * Configuration for interaction behavior.
 */
export interface InteractionOptions {
  /** Enable zoom via mouse wheel. Default: true */
  enableZoom?: boolean;

  /** Enable pan via mouse drag. Default: true */
  enablePan?: boolean;

  /** Zoom sensitivity multiplier. Default: 1.0 */
  zoomSensitivity?: number;

  /** Invert zoom direction. Default: false */
  invertZoom?: boolean;
}

/**
 * Callback for interaction events.
 */
export interface InteractionCallbacks {
  /** Called when viewport changes (zoom or pan). */
  onViewportChange?: () => void;

  /** Called when mouse position changes over timeline. */
  onMouseMove?: (x: number, y: number) => void;

  /** Called when mouse clicks on timeline. */
  onClick?: (x: number, y: number) => void;

  /** Called when hover state over event changes. Returns true if over an event. */
  onHoverChange?: (isOverEvent: boolean) => void;

  /** Called when mouse leaves the canvas. */
  onMouseLeave?: () => void;
}

export class TimelineInteractionHandler {
  private canvas: HTMLCanvasElement;
  private viewport: TimelineViewport;
  private options: Required<InteractionOptions>;
  private callbacks: InteractionCallbacks;

  // Interaction state
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private lastTouchX = 0;
  private lastTouchY = 0;
  private isOverEvent = false;
  private isMouseDown = false;

  // Event listener references for cleanup

  // Stores handlers; supports registering subtype-specific handlers (e.g. MouseEvent, WheelEvent)
  // by casting to the base Event signature internally.
  private boundHandlers: Map<string, (e: Event) => void> = new Map();

  /**
   * Register an event handler that may use a more specific Event subtype.
   * Stored internally as (e: Event) => void for uniform cleanup.
   */
  private registerBoundHandler<E extends Event>(key: string, handler: (e: E) => void): void {
    this.boundHandlers.set(key, handler as (e: Event) => void);
  }

  constructor(
    canvas: HTMLCanvasElement,
    viewport: TimelineViewport,
    options: InteractionOptions = {},
    callbacks: InteractionCallbacks = {},
  ) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.callbacks = callbacks;

    // Apply default options
    this.options = {
      enableZoom: options.enableZoom ?? true,
      enablePan: options.enablePan ?? true,
      zoomSensitivity: options.zoomSensitivity ?? 1.0,
      invertZoom: options.invertZoom ?? false,
    };

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

  /**
   * Attach event listeners to canvas.
   */
  private attachEventListeners(): void {
    // Wheel for zoom
    if (this.options.enableZoom) {
      const wheelHandler = this.handleWheel.bind(this);
      this.canvas.addEventListener('wheel', wheelHandler, { passive: false });
      this.registerBoundHandler('wheel', wheelHandler);
    }

    // Mouse events for pan and selection
    if (this.options.enablePan) {
      const mouseDownHandler = this.handleMouseDown.bind(this);
      const mouseMoveHandler = this.handleMouseMove.bind(this);
      const mouseUpHandler = this.handleMouseUp.bind(this);

      this.canvas.addEventListener('mousedown', mouseDownHandler);
      this.canvas.addEventListener('mousemove', mouseMoveHandler);
      this.canvas.addEventListener('mouseup', mouseUpHandler);
      this.registerBoundHandler('mousedown', mouseDownHandler);
      this.registerBoundHandler('mousemove', mouseMoveHandler);
      this.registerBoundHandler('mouseup', mouseUpHandler);

      // Touch events for swipe/pan on touch devices
      const touchStartHandler = this.handleTouchStart.bind(this);
      const touchMoveHandler = this.handleTouchMove.bind(this);
      const touchEndHandler = this.handleTouchEnd.bind(this);

      this.canvas.addEventListener('touchstart', touchStartHandler, { passive: false });
      this.canvas.addEventListener('touchmove', touchMoveHandler, { passive: false });
      this.canvas.addEventListener('touchend', touchEndHandler);

      this.registerBoundHandler('touchstart', touchStartHandler);
      this.registerBoundHandler('touchmove', touchMoveHandler);
      this.registerBoundHandler('touchend', touchEndHandler);
    }

    // Click for event selection
    const clickHandler = this.handleClick.bind(this);
    this.canvas.addEventListener('click', clickHandler);
    this.registerBoundHandler('click', clickHandler);

    // Mouse leave for hiding tooltips
    const mouseLeaveHandler = this.handleMouseLeave.bind(this);
    this.canvas.addEventListener('mouseleave', mouseLeaveHandler);
    this.registerBoundHandler('mouseleave', mouseLeaveHandler);
  }

  /**
   * Remove event listeners from canvas.
   */
  private detachEventListeners(): void {
    if (this.options.enableZoom) {
      const wheelHandler = this.boundHandlers.get('wheel');
      if (wheelHandler) {
        this.canvas.removeEventListener('wheel', wheelHandler);
      }
    }

    if (this.options.enablePan) {
      const mouseDownHandler = this.boundHandlers.get('mousedown');
      const mouseMoveHandler = this.boundHandlers.get('mousemove');
      const mouseUpHandler = this.boundHandlers.get('mouseup');

      if (mouseDownHandler) {
        this.canvas.removeEventListener('mousedown', mouseDownHandler);
      }
      if (mouseMoveHandler) {
        this.canvas.removeEventListener('mousemove', mouseMoveHandler);
      }
      if (mouseUpHandler) {
        this.canvas.removeEventListener('mouseup', mouseUpHandler);
      }

      // Remove touch event listeners
      const touchStartHandler = this.boundHandlers.get('touchstart');
      const touchMoveHandler = this.boundHandlers.get('touchmove');
      const touchEndHandler = this.boundHandlers.get('touchend');

      if (touchStartHandler) {
        this.canvas.removeEventListener('touchstart', touchStartHandler);
      }
      if (touchMoveHandler) {
        this.canvas.removeEventListener('touchmove', touchMoveHandler);
      }
      if (touchEndHandler) {
        this.canvas.removeEventListener('touchend', touchEndHandler);
      }
    }

    const clickHandler = this.boundHandlers.get('click');
    if (clickHandler) {
      this.canvas.removeEventListener('click', clickHandler);
    }

    const mouseLeaveHandler = this.boundHandlers.get('mouseleave');
    if (mouseLeaveHandler) {
      this.canvas.removeEventListener('mouseleave', mouseLeaveHandler);
    }

    this.boundHandlers.clear();
  }

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  /**
   * Handle wheel event for zoom and pan.
   *
   * Implements:
   * - Shift + wheel: Vertical pan (scroll up/down in stack depth) - respects natural scrolling
   * - Alt/Option + wheel: Horizontal pan (scroll left/right in time)
   * - Horizontal wheel (deltaX): Pan (trackpad swipe left/right)
   * - Vertical wheel (deltaY): Mouse-anchored zoom
   * - Mouse cursor position remains over the same timeline point during zoom
   * - Prevents page scroll
   */
  private handleWheel(event: WheelEvent): void {
    event.preventDefault();

    // Shift + wheel = Vertical pan (stack depth)
    // Uses deltaY directly for natural scrolling feel (scroll down = view moves down)
    if (event.shiftKey && this.options.enablePan) {
      const changed = this.viewport.panBy(0, event.deltaY);
      if (changed && this.callbacks.onViewportChange) {
        this.callbacks.onViewportChange();
      }
      return;
    }

    // Alt/Option + wheel = Horizontal pan (time axis)
    // Uses deltaY as horizontal movement (since wheel primarily produces deltaY)
    if (event.altKey && this.options.enablePan) {
      const changed = this.viewport.panBy(-event.deltaY, 0);
      if (changed && this.callbacks.onViewportChange) {
        this.callbacks.onViewportChange();
      }
      return;
    }

    // Handle horizontal pan (trackpad swipe left/right)
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && this.options.enablePan) {
      // Horizontal wheel event detected - treat as pan
      const changed = this.viewport.panBy(event.deltaX, 0);

      // Notify callback if viewport changed
      if (changed && this.callbacks.onViewportChange) {
        this.callbacks.onViewportChange();
      }
      return;
    }

    // Handle vertical zoom
    if (!this.options.enableZoom) {
      return;
    }

    // Get mouse position relative to canvas
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;

    // Calculate zoom delta
    // deltaY is positive when scrolling down, negative when scrolling up
    // Standard behavior: scroll up = zoom in, scroll down = zoom out
    let zoomDelta = -event.deltaY;

    // Apply zoom inversion if enabled
    if (this.options.invertZoom) {
      zoomDelta = -zoomDelta;
    }

    // Normalize wheel delta (different browsers report different scales)
    // Use deltaMode to handle different units (pixels, lines, pages)
    let normalizedDelta = zoomDelta;
    if (event.deltaMode === 1) {
      // Lines - multiply by typical line height
      normalizedDelta *= 15;
    } else if (event.deltaMode === 2) {
      // Pages - multiply by typical page height
      normalizedDelta *= 800;
    }

    // Calculate zoom factor
    // Use exponential scaling for smooth zoom feel
    const zoomFactor = 1 + normalizedDelta * 0.001 * this.options.zoomSensitivity;

    // Get current zoom and calculate new zoom
    const currentState = this.viewport.getState();
    const newZoom = currentState.zoom * zoomFactor;

    // Apply zoom with mouse position as anchor
    const changed = this.viewport.setZoom(newZoom, mouseX);

    // Notify callback if viewport changed
    if (changed && this.callbacks.onViewportChange) {
      this.callbacks.onViewportChange();
    }
  }

  /**
   * Handle mouse down - start drag operation.
   */
  private handleMouseDown(event: MouseEvent): void {
    if (!this.options.enablePan) {
      return;
    }

    // Only handle left mouse button
    if (event.button !== 0) {
      return;
    }

    this.isDragging = true;
    this.isMouseDown = true;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;

    // Change cursor to grabbing
    this.canvas.style.cursor = 'grabbing';
  }

  /**
   * Handle mouse move - perform drag or update hover state.
   */
  private handleMouseMove(event: MouseEvent): void {
    if (this.isDragging && this.options.enablePan) {
      // Clear click flag since we're dragging
      this.isMouseDown = false;

      // Calculate delta from last position
      const deltaX = event.clientX - this.lastMouseX;
      const deltaY = event.clientY - this.lastMouseY;

      // Update pan (note: negative delta because we're dragging the viewport)
      const changed = this.viewport.panBy(-deltaX, -deltaY);

      // Update last position
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;

      // Notify callback if viewport changed
      if (changed && this.callbacks.onViewportChange) {
        this.callbacks.onViewportChange();
      }
    } else {
      // Not dragging - update mouse position for hover effects
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      if (this.callbacks.onMouseMove) {
        this.callbacks.onMouseMove(mouseX, mouseY);
      }
    }
  }

  /**
   * Handle mouse up - end drag operation.
   */
  private handleMouseUp(event: MouseEvent): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;

    // Restore cursor based on whether we're over an event
    this.canvas.style.cursor = this.isOverEvent ? 'pointer' : 'grab';

    // Update mouse position for hover effects after drag ends
    // This ensures tooltip state is updated immediately when panning stops
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    if (this.callbacks.onMouseMove) {
      this.callbacks.onMouseMove(mouseX, mouseY);
    }
  }

  /**
   * Handle click - event selection.
   */
  private handleClick(event: MouseEvent): void {
    // Only fire click if mousedown occurred without dragging
    if (!this.isMouseDown) {
      return;
    }

    this.isMouseDown = false;

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    if (this.callbacks.onClick) {
      this.callbacks.onClick(mouseX, mouseY);
    }
  }

  /**
   * Handle mouse leave - end drag and notify when cursor exits canvas.
   */
  private handleMouseLeave(_event: MouseEvent): void {
    // End any active drag operation when cursor leaves canvas
    if (this.isDragging) {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
    }

    // Reset mouse down state
    this.isMouseDown = false;

    if (this.callbacks.onMouseLeave) {
      this.callbacks.onMouseLeave();
    }
  }

  // ============================================================================
  // TOUCH EVENT HANDLERS
  // ============================================================================

  /**
   * Handle touch start - begin swipe/pan gesture.
   */
  private handleTouchStart(event: TouchEvent): void {
    event.preventDefault(); // Prevent default touch behavior (scrolling)

    if (!this.options.enablePan || event.touches.length === 0) {
      return;
    }

    // Only handle single-finger touch for pan
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      this.isDragging = true;
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;

      // Change cursor to grabbing
      this.canvas.style.cursor = 'grabbing';
    }
  }

  /**
   * Handle touch move - perform swipe/pan gesture.
   */
  private handleTouchMove(event: TouchEvent): void {
    event.preventDefault(); // Prevent default touch behavior (scrolling)

    if (!this.isDragging || !this.options.enablePan || event.touches.length === 0) {
      return;
    }

    // Only handle single-finger touch for pan
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      // Calculate delta from last position
      const deltaX = touch.clientX - this.lastTouchX;
      const deltaY = touch.clientY - this.lastTouchY;

      // Update pan (note: negative delta because we're dragging the viewport)
      const changed = this.viewport.panBy(-deltaX, -deltaY);

      // Update last position
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;

      // Notify callback if viewport changed
      if (changed && this.callbacks.onViewportChange) {
        this.callbacks.onViewportChange();
      }
    }
  }

  /**
   * Handle touch end - end swipe/pan gesture.
   */
  private handleTouchEnd(_event: TouchEvent): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;

    // Restore cursor
    this.canvas.style.cursor = 'grab';

    // Update position for hover effects after touch ends
    // Use last tracked touch position since changedTouches may not have coordinates
    if (this.callbacks.onMouseMove) {
      const rect = this.canvas.getBoundingClientRect();
      // Use the last known touch position converted to canvas coordinates
      const mouseX = this.lastTouchX - rect.left;
      const mouseY = this.lastTouchY - rect.top;
      this.callbacks.onMouseMove(mouseX, mouseY);
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Enable or disable zoom interaction.
   */
  public setZoomEnabled(enabled: boolean): void {
    if (this.options.enableZoom === enabled) {
      return;
    }

    this.options.enableZoom = enabled;

    // Reattach listeners
    this.detachEventListeners();
    this.attachEventListeners();
  }

  /**
   * Enable or disable pan interaction.
   */
  public setPanEnabled(enabled: boolean): void {
    if (this.options.enablePan === enabled) {
      return;
    }

    this.options.enablePan = enabled;

    // Reattach listeners
    this.detachEventListeners();
    this.attachEventListeners();
  }

  /**
   * Set zoom sensitivity.
   */
  public setZoomSensitivity(sensitivity: number): void {
    this.options.zoomSensitivity = Math.max(0.1, Math.min(10, sensitivity));
  }

  /**
   * Update cursor based on hover state over events.
   * @param isOverEvent - Whether cursor is over an event
   */
  public updateCursor(isOverEvent: boolean): void {
    if (this.isDragging) {
      // Don't change cursor while dragging
      return;
    }

    if (isOverEvent !== this.isOverEvent) {
      this.isOverEvent = isOverEvent;
      this.canvas.style.cursor = isOverEvent ? 'pointer' : 'grab';
    }
  }
}
