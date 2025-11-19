/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Setup ResizeObserver to handle window resize with debouncing.
 */

/**
 * Interface for objects that can handle resize events.
 * Implemented by both FlameChart and TimelineRenderer.
 */
export interface IResizable {
  resize(width: number, height: number): void;
}

export class TimelineResizeHandler {
  private resizeObserver: ResizeObserver | null = null;
  private containerRef: HTMLElement;
  private renderer: IResizable | null = null;

  private resizeDebounceFrameId: number | null = null;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;

  constructor(containerRef: HTMLElement, renderer: IResizable) {
    this.containerRef = containerRef;
    this.renderer = renderer;
  }

  public setupResizeObserver(): void {
    if (!this.containerRef) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      // Debounce resize handling to prevent flickering
      // Clear any existing frame request
      if (this.resizeDebounceFrameId !== null) {
        cancelAnimationFrame(this.resizeDebounceFrameId);
      }

      // Schedule resize handling on next frame
      this.resizeDebounceFrameId = requestAnimationFrame(() => {
        this.handleResize();
        this.resizeDebounceFrameId = null;
      });
    });

    this.resizeObserver.observe(this.containerRef);
  }

  public destroy(): void {
    // Clear any pending resize frame request
    if (this.resizeDebounceFrameId !== null) {
      cancelAnimationFrame(this.resizeDebounceFrameId);
      this.resizeDebounceFrameId = null;
    }

    // Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /**
   * Handle container resize efficiently without full re-initialization.
   * Preserves viewport zoom/pan state.
   */
  private handleResize(): void {
    if (!this.containerRef || !this.renderer) {
      return;
    }

    const { width, height } = this.containerRef.getBoundingClientRect();
    if (width <= 0 || height <= 0) {
      return;
    }

    // Round to prevent sub-pixel resize thrashing
    const roundedWidth = Math.round(width);
    const roundedHeight = Math.round(height);

    // Skip if dimensions haven't actually changed (prevents duplicate calls)
    if (roundedWidth === this.lastResizeWidth && roundedHeight === this.lastResizeHeight) {
      return;
    }

    // Update last resize dimensions
    this.lastResizeWidth = roundedWidth;
    this.lastResizeHeight = roundedHeight;

    // Use efficient resize method that preserves state
    this.renderer.resize(roundedWidth, roundedHeight);
  }
}
