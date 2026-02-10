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
  private lastResizeWidth: number;
  private lastResizeHeight: number;

  /**
   * @param containerRef - The container element to observe for resize
   * @param renderer - The resizable component to notify on resize
   */
  constructor(containerRef: HTMLElement, renderer: IResizable) {
    this.containerRef = containerRef;
    this.renderer = renderer;

    // Dimensions will be populated when setupResizeObserver() is called.
    // This is deferred until after first render to avoid double render on init.
    this.lastResizeWidth = 0;
    this.lastResizeHeight = 0;
  }

  public setupResizeObserver(): void {
    if (!this.containerRef) {
      return;
    }

    // Read current dimensions as baseline (after layout is finalized from first render).
    // This ensures ResizeObserver only triggers for actual subsequent resizes.
    const { width, height } = this.containerRef.getBoundingClientRect();
    this.lastResizeWidth = Math.round(width);
    this.lastResizeHeight = Math.round(height);

    this.resizeObserver = new ResizeObserver(() => {
      // Check dimensions immediately - handles initial callback naturally
      // If dimensions match what init() used, skip (no redundant render)
      // If dimensions changed (layout shift during init), handle it
      const { width, height } = this.containerRef.getBoundingClientRect();
      const roundedWidth = Math.round(width);
      const roundedHeight = Math.round(height);

      if (roundedWidth === this.lastResizeWidth && roundedHeight === this.lastResizeHeight) {
        return; // Skip if unchanged (covers initial callback case)
      }

      // Update dimensions before debounce to prevent rapid duplicate checks
      this.lastResizeWidth = roundedWidth;
      this.lastResizeHeight = roundedHeight;

      // Debounce actual resize handling to prevent flickering
      if (this.resizeDebounceFrameId !== null) {
        cancelAnimationFrame(this.resizeDebounceFrameId);
      }

      this.resizeDebounceFrameId = requestAnimationFrame(() => {
        this.renderer?.resize(roundedWidth, roundedHeight);
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
}
