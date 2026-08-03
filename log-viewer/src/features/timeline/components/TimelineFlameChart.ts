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

import type { ApexLog } from 'apex-log-parser';
import { themeObserver } from '../../../core/theme/ThemeObserver.js';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';
import { parseColorToHex } from '../optimised/rendering/ColorUtils.js';
import type { EditorColors, TimelineOptions } from '../types/flamechart.types.js';
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

  @property()
  themeName: string | null = null;

  /**
   * Timestamp to navigate to after initialization.
   * Used when opening the timeline from a raw log file hover.
   */
  @property({ type: Number })
  navigateToTimestamp: number | undefined = undefined;

  /**
   * Event index to navigate to after initialization.
   * Preferred over timestamp because it is unique within a parse.
   */
  @property({ type: Number })
  navigateToEventIndex: number | undefined = undefined;

  /**
   * Optional configuration options.
   */
  @state()
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

  /** Unsubscribe for the appearance subscription; set while connected. */
  private themeUnsubscribe: (() => void) | null = null;

  /** Bumped by every `cleanup()`, so an in-flight `init` can tell it was superseded. */
  private initEpoch = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.themeUnsubscribe ??= themeObserver.on(() => {
      this.refreshTheme();
    });
  }

  override disconnectedCallback(): void {
    this.themeUnsubscribe?.();
    this.themeUnsubscribe = null;
    // A `lana.timeline.legacy` toggle swaps this element out while the panel is
    // open, so the Pixi app has to go with it or its WebGL context leaks.
    this.cleanup();
    super.disconnectedCallback();
  }

  override updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);

    // Re-initialize if apexLog or options change
    if (
      (changedProperties.has('apexLog') || changedProperties.has('options')) &&
      this.containerRef
    ) {
      this.initializeTimeline();
    } else if (changedProperties.has('themeName')) {
      // `else`: opening a log lands both properties in one update, and
      // `initializeTimeline` already reads the current appearance. Only the
      // category palette moved, so the CSS reads stay untouched — a quick-pick
      // preview sends one of these per keystroke.
      this.apexLogTimeline?.setTheme(this.themeName ?? '');
    }
  }

  /**
   * Push the current appearance into the renderers.
   *
   * Both halves move together: the category palette named by `themeName`, and the
   * editor colors read out of CSS. Deliberately never re-runs
   * {@link initializeTimeline} — tearing down the Pixi app on a theme switch would
   * blow the perf budget on large logs.
   */
  private refreshTheme(): void {
    if (!this.apexLogTimeline) {
      return;
    }

    this.apexLogTimeline.setEditorColors(this.extractEditorColors());
    this.apexLogTimeline.setTheme(this.themeName ?? '');
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

      const optionsWithTheme = {
        ...this.options,
        themeName: this.themeName,
        editorColors: this.extractEditorColors(),
      };

      const epoch = this.initEpoch;
      const timeline = new ApexLogTimeline();
      await timeline.init(this.containerRef, this.apexLog, optionsWithTheme);

      // `init` is async, so a second re-init (or a disconnect) can land while it
      // runs. The later one owns the container — drop this Pixi app instead of
      // leaking it over the top.
      if (epoch !== this.initEpoch) {
        timeline.destroy();
        return;
      }
      this.apexLogTimeline = timeline;

      // Navigate after initialization completes, preferring unique eventIndex.
      if (this.navigateToEventIndex !== undefined) {
        timeline.navigateToEventIndex(this.navigateToEventIndex);
      } else if (this.navigateToTimestamp !== undefined) {
        timeline.navigateToTimestamp(this.navigateToTimestamp);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Set the time display mode on the axis (called by parent TimelineView).
   */
  public setTimeDisplayMode(mode: 'elapsed' | 'wallClock'): void {
    this.apexLogTimeline?.setTimeDisplayMode(mode);
  }

  // ============================================================================
  // COLOR EXTRACTION
  // ============================================================================

  /**
   * Extract resolved editor colors from CSS custom properties (--tl-*).
   * These are passed to PixiJS renderers so they don't read CSS directly.
   */
  private extractEditorColors(): EditorColors {
    const style = getComputedStyle(this);
    return {
      cursorForeground: parseColorToHex(
        style.getPropertyValue('--tl-cursor-foreground').trim() || '#fff',
        0xffffff,
      ),
      focusBorder: parseColorToHex(
        style.getPropertyValue('--tl-focus-border').trim() || '#007fd4',
        0x007fd4,
      ),
      findMatchBackground: parseColorToHex(
        style.getPropertyValue('--tl-find-match-background').trim() || '#ff9632',
        0xea5c00,
      ),
      widgetBackground: parseColorToHex(
        style.getPropertyValue('--tl-widget-background').trim() || '#252526',
        0x252526,
      ),
      lineNumberForeground: parseColorToHex(
        style.getPropertyValue('--tl-line-number-foreground').trim() || '#808080',
        0x808080,
      ),
      editorForeground: parseColorToHex(
        style.getPropertyValue('--tl-editor-foreground').trim() || '#cccccc',
        0xcccccc,
      ),
      selectionBackground: parseColorToHex(
        style.getPropertyValue('--tl-selection-background').trim() || 'rgba(38, 79, 120, 0.5)',
        0x264f78,
      ),
      selectionHighlightBorder: parseColorToHex(
        style.getPropertyValue('--tl-selection-highlight-border').trim() || '#007fd4',
        0x007fd4,
      ),
    };
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Clean up renderer and observers.
   */
  private cleanup(): void {
    // Supersede any in-flight `initializeTimeline`.
    this.initEpoch++;

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
