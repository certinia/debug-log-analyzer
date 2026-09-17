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

  private lastResizeWidth: number;
  private lastResizeHeight: number;

  private dprQuery: MediaQueryList | null = null;

  private readonly onDevicePixelRatioChange = (): void => {
    this.watchDevicePixelRatio();

    // A zoom step moves the ratio and the box together, and this runs before the observer's
    // callback. Replaying the old size would paint a box the zoom has left, then paint again.
    const { width, height } = this.containerRef.getBoundingClientRect();
    this.lastResizeWidth = Math.round(width);
    this.lastResizeHeight = Math.round(height);

    if (this.lastResizeWidth <= 0 || this.lastResizeHeight <= 0) {
      return;
    }

    this.renderer?.resize(this.lastResizeWidth, this.lastResizeHeight);
  };

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

      this.lastResizeWidth = roundedWidth;
      this.lastResizeHeight = roundedHeight;

      // Straight through, with no frame in between. Observer callbacks are delivered after
      // this frame's animation callbacks, so a resize deferred to the next frame sizes the
      // canvas to a box the drag has already left: one frame behind on every step of a drag,
      // which reads as the chart sliding off the bottom edge until the drag stops.
      // Nothing inside the observed element can change that element's height, so this cannot
      // start an observer loop.
      this.renderer?.resize(roundedWidth, roundedHeight);
    });

    this.resizeObserver.observe(this.containerRef);
    this.watchDevicePixelRatio();
  }

  private watchDevicePixelRatio(): void {
    // No event reports a ratio change, and a query only matches the ratio it was made at, so it
    // is re-made each time it stops matching.
    this.dprQuery =
      globalThis.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    this.dprQuery?.addEventListener('change', this.onDevicePixelRatioChange, { once: true });
  }

  public destroy(): void {
    // Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.dprQuery?.removeEventListener('change', this.onDevicePixelRatioChange);
    this.dprQuery = null;
  }
}
