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
import type { ApexLog } from '../../../core/log-parser/LogEvents.js';
import { getSettings } from '../../settings/Settings.js';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';
import { tooltipStyles } from '../styles/timeline.css.js';
import type { TimelineOptions } from '../types/timeline.types.js';
import { TimelineError, TimelineErrorCode } from '../types/timeline.types.js';

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

  private apexLogTimeline: ApexLogTimeline | null = null;
  private containerRef: HTMLElement | null = null;

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
    if (this.rootLog.duration.total === 0) {
      this.isLoading = false;
      this.errorMessage = 'Nothing to show';
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

      this.apexLogTimeline = new ApexLogTimeline();
      await this.apexLogTimeline.init(this.containerRef, this.rootLog, optionsWithColors);

      this.isInitialized = true;
      this.isLoading = false;
    } catch (error) {
      this.handleError(error);
    }
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Clean up renderer and observers.
   */
  private cleanup(): void {
    // Destroy renderer
    if (this.apexLogTimeline) {
      this.apexLogTimeline.destroy();
      this.apexLogTimeline = null;
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
