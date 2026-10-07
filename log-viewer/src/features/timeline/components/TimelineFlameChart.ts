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

import type { ApexLog } from '@apexdevtools/apex-log-parser';
import { SubscriptionController } from '../../../core/events/SubscriptionController.js';
import { setRange, windowFor } from '../../../core/log/rangeScope.js';
import { debounce, setChanged } from '../../../core/utility/Util.js';
import { themeObserver } from '../../../core/theme/ThemeObserver.js';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';
import type { MeasurementSnapshot } from '../optimised/measurement/MeasurementState.js';
import { parseColorToHex } from '../optimised/rendering/ColorUtils.js';
import { calculateViewportBounds } from '../optimised/ViewportUtils.js';
import type { EditorColors, TimelineOptions, ViewportState } from '../types/flamechart.types.js';
import { TimelineError } from '../types/flamechart.types.js';

import { tokenStyles } from '../../../styles/tokens.styles.js';
import { tooltipStyles } from '../styles/timeline.css.js';

@customElement('timeline-flame-chart')
export class TimelineFlameChart extends LitElement {
  static styles = [
    tokenStyles,
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
        padding: var(--lana-space-lg);
        background: var(--vscode-inputValidation-errorBackground, #ffebee);
        border: var(--lana-stroke) solid var(--vscode-inputValidation-errorBorder, #ef5350);
        border-radius: var(--lana-radius-sm);
        color: var(--vscode-inputValidation-errorForeground, var(--lana-severity-error));
        max-width: 80%;
        text-align: center;
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
   * Show the hover/selection details panel. A property, not a setter, so the value
   * survives a chart re-initialisation.
   */
  @property({ type: Boolean })
  showTooltip = true;

  /**
   * Categories kept in colour while the rest of the chart is dimmed; empty for none.
   * A property, so the highlight survives a chart re-initialisation.
   */
  @property({ attribute: false, hasChanged: setChanged })
  dimCategories: ReadonlySet<string> = new Set();

  /**
   * Optional configuration options.
   */
  @state()
  options: TimelineOptions = {};

  // ============================================================================
  // STATE
  // ============================================================================

  @state()
  private errorMessage: string | null = null;

  private apexLogTimeline: ApexLogTimeline | null = null;

  @query('.timeline-container')
  private containerRef!: HTMLElement;

  /** Bumped by every `cleanup()`, so an in-flight `init` can tell it was superseded. */
  private initEpoch = 0;

  private readonly subscriptions = new SubscriptionController(this, () => [
    themeObserver.on(() => {
      this.refreshTheme();
    }),
  ]);

  override connectedCallback(): void {
    super.connectedCallback();

    // `updated` re-initialises only when the log or the options change, so a
    // re-attach would otherwise leave the destroyed Pixi app unrebuilt.
    if (this.apexLog) {
      void this.initializeTimeline();
    }
  }

  override disconnectedCallback(): void {
    // Lit can drop this element while the panel stays open, so the Pixi app has to go
    // with it or its WebGL context leaks.
    super.disconnectedCallback();
    this.cleanup();
  }

  override updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);

    // Re-initialize if apexLog or options change
    if (
      (changedProperties.has('apexLog') || changedProperties.has('options')) &&
      this.containerRef
    ) {
      void this.initializeTimeline();
    } else if (changedProperties.has('themeName')) {
      // `else`: opening a log lands both properties in one update, and
      // `initializeTimeline` already reads the current appearance. Only the
      // category palette moved, so the CSS reads stay untouched — a quick-pick
      // preview sends one of these per keystroke.
      this.apexLogTimeline?.setTheme(this.themeName ?? '');
    }

    // Independent of the branch above: `initializeTimeline` is async, so the flag is
    // also applied when the timeline appears (see `initializeTimeline`).
    if (changedProperties.has('showTooltip')) {
      this.apexLogTimeline?.setTooltipEnabled(this.showTooltip);
    }
    if (changedProperties.has('dimCategories')) {
      this.apexLogTimeline?.setCategoryDim(this.dimCategories);
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
        onViewportChange: (viewport: ViewportState) => {
          this.options.onViewportChange?.(viewport);
          this._viewport = viewport;
          this._publishRange();
        },
        onMeasurementChange: (measurement: MeasurementSnapshot | null) => {
          this.options.onMeasurementChange?.(measurement);
          this._measurement = measurement;
          this._publishRange();
        },
        // The view cancels the event once the legend drops its picks.
        onCategoryDimClear: () =>
          !this.dispatchEvent(
            new Event('category-highlight-clear', { bubbles: true, cancelable: true }),
          ),
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
      timeline.setTooltipEnabled(this.showTooltip);
      timeline.setCategoryDim(this.dimCategories);

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

  private _viewport: ViewportState | null = null;
  private _measurement: MeasurementSnapshot | null = null;

  /**
   * Records the stretch of log the user is reading, for the inspector's
   * sections: a measured range where there is one, else the viewport. The
   * chart owns both, so it also decides when one is wide enough to be the
   * whole log.
   *
   * Coalesced to one publish per frame: a drag reports a viewport per input
   * event, and a frame can only show one of them.
   */
  private readonly _publishRange = debounce(() => {
    const measurement = this._measurement;
    // A Shift+click with no drag measures nothing, so the viewport still stands.
    const span =
      measurement && measurement.endTime > measurement.startTime
        ? { timeStart: measurement.startTime, timeEnd: measurement.endTime }
        : this._viewport && calculateViewportBounds(this._viewport);
    const logStart = this.apexLog?.timestamp ?? 0;
    const logEnd = this.apexLog?.exitStamp ?? logStart;
    setRange(span ? windowFor(span.timeStart, span.timeEnd, logStart, logEnd) : null);
  });

  /**
   * Clean up renderer and observers.
   */
  private cleanup(): void {
    // Supersede any in-flight `initializeTimeline`.
    this.initEpoch++;
    // No chart, no window: the sections read the whole log again. A frame
    // queued before the teardown must not put the window back.
    this._publishRange.cancel();
    this._viewport = null;
    this._measurement = null;
    setRange(null);

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
