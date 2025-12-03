/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * TimelineFlameChart
 *
 * Lit web component wrapping PixiJS timeline renderer.
 * Provides integration layer between application and PixiTimelineRenderer.
 */

import { css, html, LitElement, type PropertyValues, unsafeCSS } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

import type { ApexLog } from '../../../core/log-parser/LogEvents.js';
import { getSettings } from '../../settings/Settings.js';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';

import type { TimelineOptions } from '../types/flamechart.types.js';
import { TimelineError } from '../types/flamechart.types.js';

import { tooltipStyles } from '../styles/timeline.css.js';

@customElement('timeline-flame-chart')
export class TimelineFlameChart extends LitElement {
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
  apexLog: ApexLog | null = null;

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

  private apexLogTimeline: ApexLogTimeline | null = null;

  @query('.timeline-container')
  private containerRef!: HTMLElement;

  override updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);

    // Re-initialize if apexLog or options change
    if (
      (changedProperties.has('apexLog') || changedProperties.has('options')) &&
      this.containerRef
    ) {
      this.initializeTimeline();
    }
  }

  /**
   * Initialize PixiJS timeline renderer.
   */
  private async initializeTimeline(): Promise<void> {
    if (!this.containerRef || !this.apexLog) {
      return;
    }

    // Clean up existing renderer
    this.cleanup();

    if (this.apexLog.duration.total === 0) {
      this.errorMessage = 'Nothing to show';
      return;
    }

    try {
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
      await this.apexLogTimeline.init(this.containerRef, this.apexLog, optionsWithColors);
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
  }

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  /**
   * Handle initialization errors.
   */
  private handleError(error: unknown): void {
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
        ${this.errorMessage ? html`<div class="error-message">${this.errorMessage}</div>` : ''}
      </div>
    `;
  }
}
