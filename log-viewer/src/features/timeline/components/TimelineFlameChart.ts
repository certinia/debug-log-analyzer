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
import { ResizeController } from '../../../core/events/ResizeController.js';
import { SubscriptionController } from '../../../core/events/SubscriptionController.js';
import { setRange, windowFor } from '../../../core/log/rangeScope.js';
import { waitForNextFrame } from '../../../core/utility/FrameBudget.js';
import { debounce, isVisible, setChanged } from '../../../core/utility/Util.js';
import { themeObserver } from '../../../core/theme/ThemeObserver.js';
import { FindController } from '../../find/FindController.js';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';
import { MIN_CHART_HEIGHT } from '../optimised/chartLayout.js';
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

      .timeline-layer {
        position: absolute;
        inset: 0;
      }

      .timeline-container--small .timeline-layer {
        visibility: hidden;
      }

      .too-small {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--lana-space-lg);
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-base);
        text-align: center;
        /* Always present, so a screen reader announces the note when it appears. */
        pointer-events: none;
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

  /** The container is too short to draw in, so the chart waits, or hides, until it grows. */
  @state()
  private tooSmall = false;
  /** A build skipped for size, run once the container grows: its `keepViewport`, else null. */
  private sizeDeferred: boolean | null = null;

  private apexLogTimeline: ApexLogTimeline | null = null;
  /** The element {@link apexLogTimeline} draws in. */
  private timelineLayer: HTMLElement | null = null;
  private pendingViewport: ViewportState | null = null;

  @query('.timeline-container')
  private containerRef!: HTMLElement;

  /** Bumped by every `cleanup()`, so an in-flight `init` can tell it was superseded. */
  private initEpoch = 0;
  private visibilityWait: AbortController | null = null;

  private readonly finder = new FindController(this, {
    targets: () => (this.apexLogTimeline ? [this.apexLogTimeline.findTarget] : []),
  });

  private readonly resize = new ResizeController(this, () => this.checkSize());

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
    this.visibilityWait?.abort();
    this.cleanup();
  }

  override firstUpdated(): void {
    this.resize.observe(this.containerRef);
  }

  private checkSize(): void {
    const height = this.containerRef?.getBoundingClientRect().height;
    // 0 is a hidden tab, not a short one.
    if (!height) {
      return;
    }
    this.tooSmall = !!this.apexLog && height < MIN_CHART_HEIGHT;
    if (!this.tooSmall && this.sizeDeferred !== null) {
      void this.initializeTimeline(this.sizeDeferred);
    }
  }

  override updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);

    // Re-initialize if apexLog or options change
    if (
      (changedProperties.has('apexLog') || changedProperties.has('options')) &&
      this.containerRef
    ) {
      // A log replacing a log is the same transaction filtered, so the reader keeps their place.
      void this.initializeTimeline(!!changedProperties.get('apexLog'));
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
  private async initializeTimeline(keepViewport = false): Promise<void> {
    if (!this.containerRef || !this.apexLog) {
      return;
    }
    this.visibilityWait?.abort();
    // A hidden tab has no size to draw in, so a log that arrives there waits until the tab shows.
    if (!this.containerRef.getBoundingClientRect().width) {
      const wait = new AbortController();
      this.visibilityWait = wait;
      if (!(await isVisible(this.containerRef, undefined, wait.signal))) {
        return;
      }
    }

    // Pixi cannot lay out the chart below this height.
    const height = this.containerRef.getBoundingClientRect().height;
    this.tooSmall = height > 0 && height < MIN_CHART_HEIGHT;
    this.sizeDeferred = this.tooSmall ? keepViewport : null;
    if (this.tooSmall) {
      // A build already in flight is for older data, so it must not land.
      this.initEpoch++;
      return;
    }

    // A re-init still in flight has no timeline yet, so it hands on the place it was given.
    const viewport = keepViewport
      ? (this.apexLogTimeline?.getViewport() ?? this.pendingViewport)
      : null;
    this.pendingViewport = viewport;

    if (this.apexLog.duration.total === 0) {
      this.cleanup();
      this.errorMessage = 'Nothing to show';
      return;
    }

    // The chart on screen stays until the new one has drawn, so a level change does not blank it.
    const epoch = ++this.initEpoch;
    const layer = document.createElement('div');
    layer.className = 'timeline-layer';
    layer.style.visibility = 'hidden';
    this.containerRef.append(layer);
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

      const timeline = new ApexLogTimeline();
      await timeline.init(layer, this.apexLog, optionsWithTheme);
      timeline.setTooltipEnabled(this.showTooltip);
      timeline.setCategoryDim(this.dimCategories);

      // Navigate after initialization completes, preferring unique eventIndex.
      if (viewport) {
        timeline.setViewport(viewport);
      } else if (this.navigateToEventIndex !== undefined) {
        timeline.navigateToEventIndex(this.navigateToEventIndex);
      } else if (this.navigateToTimestamp !== undefined) {
        timeline.navigateToTimestamp(this.navigateToTimestamp);
      }
      // The move above draws on the next frame; showing the layer sooner would flash the default view.
      await waitForNextFrame();

      // `init` is async, so a second re-init (or a disconnect) can land while it
      // runs. The later one owns the container — drop this Pixi app instead of
      // leaking it over the top.
      if (epoch !== this.initEpoch) {
        timeline.destroy();
        layer.remove();
        return;
      }
      this.cleanup();
      layer.style.visibility = '';
      this.apexLogTimeline = timeline;
      void this.finder.rerun();
      this.timelineLayer = layer;
      this.pendingViewport = null;
    } catch (error) {
      layer.remove();
      if (epoch === this.initEpoch) {
        this.cleanup();
        this.handleError(error);
      }
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
      // Before the destroy: the finder would otherwise hold the old chart until the next search.
      this.finder.forget();
      this.apexLogTimeline.destroy();
      this.apexLogTimeline = null;
    }
    this.timelineLayer?.remove();
    this.timelineLayer = null;
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
      <div class="timeline-container ${this.tooSmall ? 'timeline-container--small' : ''}">
        <div class="too-small" role="status">
          ${this.tooSmall ? 'Make this pane taller to show the timeline.' : ''}
        </div>
        ${this.errorMessage ? html`<div class="error-message">${this.errorMessage}</div>` : ''}
      </div>
    `;
  }
}
