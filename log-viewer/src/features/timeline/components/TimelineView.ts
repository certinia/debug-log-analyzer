/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

import type { ApexLog, LogCategory } from 'apex-log-parser';
import { categoryPalette } from '../../../components/categoryTime.js';
import { VSCodeExtensionMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { subscribeSettings, updateSetting, type LanaSettings } from '../../settings/Settings.js';
import { setColors } from '../services/Timeline.js';

import { DEFAULT_THEME_NAME, sameColors, type TimelineColors } from '../themes/Themes.js';
import { addCustomThemes } from '../themes/ThemeSelector.js';

import { categorySelfTimes, toTimelineKeys } from '../utils/category-self-time.js';
import type { TimeDisplayMode } from '../types/flamechart.types.js';
import type { TimelineFlameChart } from './TimelineFlameChart.js';
import type { TimelineKeyEntry } from './TimelineKey.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import './TimelineFlameChart.js';
import './TimelineKey.js';
import './TimelineLegacy.js';
import './TimelineSkeleton.js';

interface ThemeSettings {
  [key: string]: {
    apex: string;
    codeUnit: string;
    system: string;
    automation: string;
    dml: string;
    soql: string;
    callout: string;
    validation: string;
  };
}

@customElement('timeline-view')
export class TimelineView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @property({ type: Number })
  navigateToTimestamp: number | undefined = undefined;

  @property({ type: Number })
  navigateToEventIndex: number | undefined = undefined;

  @state()
  activeTheme: string | null = null;

  @state()
  private timelineKeys: TimelineKeyEntry[] = [];

  /** Per-category self time for the loaded log; drives the legend durations. */
  private selfTimes?: Map<LogCategory, number>;

  /** The timeline settings last pushed; the legend's palette is resolved from them. */
  private timelineSettings: LanaSettings['timeline'] | null = null;

  @state()
  private useLegacyTimeline: boolean | null = null;

  /** Unsubscribe for the settings subscription; set while connected. */
  private settingsUnsubscribe: (() => void) | null = null;

  /** Removes the theme-preview message listener; set while connected. */
  private themePreviewUnsubscribe: (() => void) | null = null;

  /**
   * The persisted palette last applied. A quick-pick preview is not persisted, so an
   * unrelated `configChanged` push must not re-apply the stored theme over it.
   */
  private appliedThemeName: string | null = null;
  private appliedCustomThemes: { [key: string]: TimelineColors } = {};

  @state()
  private timeDisplayMode: TimeDisplayMode = 'elapsed';

  @state()
  private showTooltip = true;

  @query('timeline-flame-chart')
  private flameChartRef!: TimelineFlameChart;

  constructor() {
    super();
  }

  static styles = [
    globalStyles,
    css`
      :host {
        /* Editor */
        --tl-editor-foreground: var(--lana-editor-fg);
        --tl-cursor-foreground: var(--vscode-editorCursor-foreground, #fff);
        --tl-focus-border: var(--lana-focus-border);
        --tl-line-number-foreground: var(--vscode-editorLineNumber-foreground, #808080);

        /* Find/selection */
        --tl-find-match-background: var(--vscode-editor-findMatchBackground, #ff9632);
        --tl-selection-background: var(--vscode-editor-selectionBackground, rgba(38, 79, 120, 0.5));
        --tl-selection-highlight-border: var(--vscode-editor-selectionHighlightBorder, transparent);

        /* Widgets */
        --tl-widget-background: var(--lana-popover-bg);
        --tl-widget-border: var(--lana-surface-border);
        --tl-widget-foreground: var(--vscode-editorWidget-foreground, #cccccc);

        /* Hover/tooltip */
        --tl-hover-background: var(--lana-hover-bg);
        --tl-hover-border: var(--lana-hover-border);
        --tl-hover-foreground: var(--lana-hover-fg);

        /* Text */
        --tl-description-foreground: var(--lana-fg-muted);
        --tl-font-family: var(--lana-font-ui);

        /* Buttons */
        --tl-button-secondary-background: var(--vscode-button-secondaryBackground, #3a3d41);
        --tl-button-secondary-foreground: var(--vscode-button-secondaryForeground, #cccccc);
        --tl-button-secondary-hover-background: var(
          --vscode-button-secondaryHoverBackground,
          #45494e
        );

        display: flex;
        flex-direction: column;
        flex: 1;
        position: relative;
        width: 100%;
        height: 100%;
        /* inset previously provided by the tab panel's padding */
        padding: var(--lana-space-md) var(--lana-space-xs);
        box-sizing: border-box;
      }

      .timeline-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--lana-space-sm);
        min-width: 0;
        flex: 0 0 auto;
        margin-bottom: var(--lana-space-sm);
      }

      .timeline-toolbar timeline-key {
        flex: 1 1 auto;
        min-width: 0;
      }

      .timeline-toolbar vscode-toolbar-button {
        flex: 0 0 auto;
      }

      /* The chart takes every row the container gives it, and the renderer scrolls
         when the call depth needs more; the toolbar keeps its own height. The zero
         min-height lets the chart shrink below its content, which a flex item does
         not do by default. */
      timeline-flame-chart,
      timeline-legacy,
      timeline-skeleton {
        flex: 1 1 0;
        min-height: 0;
      }
    `,
  ];

  async connectedCallback() {
    super.connectedCallback();

    this.themePreviewUnsubscribe ??= VSCodeExtensionMessenger.listen<{ activeTheme: string }>(
      (event) => {
        const { cmd, payload } = event.data;
        if (cmd === 'switchTimelineTheme' && this.activeTheme !== payload.activeTheme) {
          this.setTheme(payload.activeTheme ?? DEFAULT_THEME_NAME);
        }
      },
    );

    // The panel is never re-created, so live `lana.timeline.*` edits only reach the
    // chart through this subscription.
    this.settingsUnsubscribe ??= subscribeSettings((settings) => {
      this.applyTimelineSettings(settings);
    });
  }

  override disconnectedCallback() {
    this.settingsUnsubscribe?.();
    this.settingsUnsubscribe = null;
    this.themePreviewUnsubscribe?.();
    this.themePreviewUnsubscribe = null;
    super.disconnectedCallback();
  }

  private applyTimelineSettings(settings: LanaSettings) {
    const { timeline } = settings;
    this.timelineSettings = timeline;
    this.useLegacyTimeline = timeline.legacy;
    this.showTooltip = timeline.showTooltip;

    if (!this.useLegacyTimeline) {
      const themeName = timeline.activeTheme ?? DEFAULT_THEME_NAME;
      const customThemes = this.toTheme(timeline.customThemes);
      if (themeName !== this.appliedThemeName || !this.sameCustomThemes(customThemes)) {
        this.appliedThemeName = themeName;
        this.appliedCustomThemes = customThemes;
        addCustomThemes(customThemes);
        this.setTheme(themeName);
        return;
      }
    } else {
      setColors(timeline.colors);
    }
    // A legacy toggle re-enters with the theme unchanged, so the legend is rebuilt
    // either way: the palette it reads differs between the two chart renderers.
    this.rebuildTimelineKeys();
  }

  /** True when the pushed custom themes match those already applied. */
  private sameCustomThemes(customThemes: { [key: string]: TimelineColors }): boolean {
    const names = Object.keys(customThemes);
    if (names.length !== Object.keys(this.appliedCustomThemes).length) {
      return false;
    }
    return names.every((name) => {
      const applied = this.appliedCustomThemes[name];
      const pushed = customThemes[name];
      return !!applied && !!pushed && sameColors(applied, pushed);
    });
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('timelineRoot')) {
      this.selfTimes = this.timelineRoot ? categorySelfTimes(this.timelineRoot) : undefined;
      this.rebuildTimelineKeys();
    }
  }

  render() {
    if (!this.timelineRoot || this.useLegacyTimeline === null) {
      return html`<timeline-skeleton></timeline-skeleton>`;
    }

    const toolbar = html`<div class="timeline-toolbar">
      <timeline-key .timelineKeys="${this.timelineKeys}"></timeline-key>
      ${this.renderTimeDisplayToggle()} ${this.renderTooltipToggle()}
    </div>`;

    if (this.useLegacyTimeline) {
      return html`${toolbar}
        <timeline-legacy
          .apexLog=${this.timelineRoot}
          .themeName=${this.activeTheme}
        ></timeline-legacy>`;
    }
    return html`${toolbar}
      <timeline-flame-chart
        .apexLog=${this.timelineRoot}
        .themeName=${this.activeTheme}
        .navigateToEventIndex=${this.navigateToEventIndex}
        .navigateToTimestamp=${this.navigateToTimestamp}
        .showTooltip=${this.showTooltip}
      ></timeline-flame-chart>`;
  }

  /** The elapsed/wall-clock switch. Legacy has no such mode, nor do logs without a start time. */
  private renderTimeDisplayToggle() {
    if (this.useLegacyTimeline || this.timelineRoot?.startTime === null) {
      return '';
    }

    const isWallClock = this.timeDisplayMode === 'wallClock';
    const label = isWallClock ? 'Show elapsed time' : 'Show wall-clock time';
    return html`<vscode-toolbar-button
      icon="${isWallClock ? 'history' : 'clockface'}"
      label="${label}"
      title="${label}"
      @click=${() => this.toggleTimeDisplay()}
    ></vscode-toolbar-button>`;
  }

  /** The hover details switch. Legacy has its own tooltip, which this does not control. */
  private renderTooltipToggle() {
    if (this.useLegacyTimeline) {
      return '';
    }

    const label = this.showTooltip ? 'Hide frame details on hover' : 'Show frame details on hover';
    return html`<vscode-toolbar-button
      icon="${this.showTooltip ? 'eye' : 'eye-closed'}"
      label="${label}"
      title="${label}"
      @click=${() => this.toggleTooltip()}
    ></vscode-toolbar-button>`;
  }

  private toggleTooltip(): void {
    this.showTooltip = !this.showTooltip;
    updateSetting('timeline.showTooltip', this.showTooltip);
  }

  private toggleTimeDisplay(): void {
    this.timeDisplayMode = this.timeDisplayMode === 'elapsed' ? 'wallClock' : 'elapsed';
    this.flameChartRef?.setTimeDisplayMode(this.timeDisplayMode);
  }

  private setTheme(themeName: string) {
    this.activeTheme = themeName ?? DEFAULT_THEME_NAME;
    this.rebuildTimelineKeys();
  }

  /**
   * Rebuilds the legend from the palette the chart drew with, plus the log's
   * per-category self times. `activeTheme` overrides the pushed one, since a
   * quick-pick preview is never persisted.
   */
  private rebuildTimelineKeys(): void {
    const timeline = this.timelineSettings;
    this.timelineKeys = toTimelineKeys(
      categoryPalette(timeline, this.activeTheme),
      this.selfTimes,
      timeline?.legacy,
    );
  }

  private toTheme(themeSettings: ThemeSettings): { [key: string]: TimelineColors } {
    const themes: { [key: string]: TimelineColors } = {};
    for (const [name, colors] of Object.entries(themeSettings)) {
      themes[name] = {
        apex: colors.apex,
        codeUnit: colors.codeUnit,
        system: colors.system,
        automation: colors.automation,
        dml: colors.dml,
        soql: colors.soql,
        callout: colors.callout,
        validation: colors.validation,
      };
    }
    return themes;
  }
}
