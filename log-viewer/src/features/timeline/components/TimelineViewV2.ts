/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * TimelineViewV2
 *
 * Lit web component wrapping PixiJS timeline renderer.
 * Provides integration layer between application and PixiTimelineRenderer.
 */

import { css, html, LitElement, type PropertyValues, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ApexLog, LogEvent } from '../../../core/log-parser/LogEvents.js';
import { getSettings } from '../../settings/Settings.js';
import { TimelineRenderer } from '../services/TimelineRenderer.js';
import { tooltipStyles } from '../styles/timeline.css.js';
import type { TimelineOptions, ViewportState } from '../types/timeline.types.js';
import { TimelineError, TimelineErrorCode } from '../types/timeline.types.js';
import { extractTruncationMarkers } from '../utils/truncation-utils.js';

@customElement('timeline-view-v2')
export class TimelineViewV2 extends LitElement {
  static styles = [
    unsafeCSS(tooltipStyles),
    css`
      :host {
        width: 100%;
        height: 100%;
        position: relative;
        overflow: hidden;
      }

      .timeline-container {
        width: 100%;
        height: 100%;
        position: relative;
      }

      .error-message {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 20px;
        background: #ffebee;
        border: 1px solid #ef5350;
        border-radius: 4px;
        color: #c62828;
        font-family: monospace;
        max-width: 80%;
        text-align: center;
      }

      .loading-message {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 20px;
        color: #666;
        font-family: monospace;
      }
    `,
  ];

  // ============================================================================
  // PROPERTIES
  // ============================================================================

  /**
   * Root log containing events to visualize.
   * Existing property for compatibility with current application.
   */
  @property({ type: Object })
  rootLog: ApexLog | null = null;

  /**
   * Optional configuration options.
   */
  @property({ type: Object })
  options: TimelineOptions = {};

  // ============================================================================
  // STATE
  // ============================================================================

  @state()
  private isInitialized = false;

  @state()
  private errorMessage: string | null = null;

  @state()
  private isLoading = false;

  private renderer: TimelineRenderer | null = null;
  private containerRef: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceFrameId: number | null = null;
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  override connectedCallback(): void {
    super.connectedCallback();
    this.isLoading = true;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.cleanup();
  }

  override firstUpdated(): void {
    // Get container reference
    this.containerRef = this.shadowRoot?.querySelector('.timeline-container') as HTMLElement;

    if (!this.containerRef) {
      this.handleError(
        new TimelineError(
          TimelineErrorCode.INVALID_CONTAINER,
          'Failed to find timeline container element',
        ),
      );
      return;
    }

    // Initialize timeline once DOM is ready
    this.initializeTimeline();

    // Setup resize observer for responsive behavior
    this.setupResizeObserver();
  }

  override updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);

    // Re-initialize if rootLog or options change
    if (changedProperties.has('rootLog') || changedProperties.has('options')) {
      if (this.isInitialized && this.containerRef) {
        this.initializeTimeline();
      }
    }
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  /**
   * Initialize PixiJS timeline renderer.
   */
  private async initializeTimeline(): Promise<void> {
    if (!this.containerRef || !this.rootLog) {
      return;
    }

    // Clean up existing renderer
    this.cleanup();

    // Extract events from rootLog
    const events = this.extractEvents();
    if (!events || events.length === 0) {
      this.isLoading = false;
      this.errorMessage = 'No events to display';
      return;
    }

    try {
      this.isLoading = true;
      this.errorMessage = null;

      // Fetch settings for custom colors
      const settings = await getSettings();
      const customColors = settings.timeline.colors;

      // Merge custom colors with options
      const optionsWithColors: TimelineOptions = {
        ...this.options,
        colors: customColors,
      };

      // Extract truncation markers from log
      const truncationMarkers = extractTruncationMarkers(this.rootLog);

      // Create new renderer
      this.renderer = new TimelineRenderer();

      // Initialize with events, truncation markers, and options
      await this.renderer.init(
        this.containerRef,
        this.rootLog,
        events,
        truncationMarkers,
        optionsWithColors,
      );

      this.isInitialized = true;
      this.isLoading = false;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Extract events array from rootLog.
   * Handles the conversion from ApexLog structure to LogEvent array.
   */
  private extractEvents(): LogEvent[] {
    if (!this.rootLog) {
      return [];
    }

    // ApexLog extends LogEvent, which has a children property
    // containing the hierarchical event structure
    return this.rootLog.children || [];
  }

  /**
   * Setup ResizeObserver to handle window resize with debouncing.
   */
  private setupResizeObserver(): void {
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

  /**
   * Handle container resize efficiently without full re-initialization.
   * Preserves viewport zoom/pan state.
   */
  private handleResize(): void {
    if (!this.isInitialized || !this.containerRef || !this.renderer) {
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

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Clean up renderer and observers.
   */
  private cleanup(): void {
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

    // Destroy renderer
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }

    this.isInitialized = false;
  }

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  /**
   * Handle initialization errors.
   */
  private handleError(error: unknown): void {
    // eslint-disable-next-line no-console
    console.error('Timeline initialization error:', error);

    this.isLoading = false;
    this.isInitialized = false;

    if (error instanceof TimelineError) {
      this.errorMessage = `${error.code}: ${error.message}`;
    } else if (error instanceof Error) {
      this.errorMessage = error.message;
    } else {
      this.errorMessage = 'Unknown error occurred';
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get current viewport state.
   * Useful for debugging or external integrations.
   */
  public getViewport(): ViewportState | null {
    return this.renderer?.getViewport() ?? null;
  }

  /**
   * Request a redraw on next frame.
   * Useful after programmatic state changes.
   */
  public requestRender(): void {
    this.renderer?.requestRender();
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  override render() {
    return html`
      <div class="timeline-container">
        ${this.isLoading ? html`<div class="loading-message">Initializing timeline...</div>` : ''}
        ${this.errorMessage ? html`<div class="error-message">${this.errorMessage}</div>` : ''}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    'timeline-view-v2': TimelineViewV2;
  }
}
