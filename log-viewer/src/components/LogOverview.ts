/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { apexLimitTimeSeries } from '../features/timeline/optimised/apex-limit-series.js';
import { globalStyles } from '../styles/global.styles.js';
import { NO_GOVERNOR_USAGE_TEXT, NO_LOG_TEXT } from './governorCopy.js';
import { seriesGauges } from './logOverviewMetrics.js';

// web components
import '../features/database/components/GovernorSummary.js';

/**
 * The inspector's whole-log section, shown while nothing is selected: the
 * governor metrics nearest a limit, read from the metric strip's series so the
 * figures always match the timeline and the trend charts.
 *
 * Log size and duration are deliberately absent — `LogMeta` heads the app with
 * both.
 */
@customElement('log-overview')
export class LogOverview extends LitElement {
  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
      }

      /* The pane body owns the left edge; the strip keeps its own row rhythm. */
      governor-summary {
        padding: var(--lana-space-2xs) 0;
      }

      .note {
        padding: var(--lana-space-sm) 0 0;
        color: var(--lana-fg-muted);
      }
    `,
  ];

  render() {
    const apexLog = this.logStore?.log;
    if (!apexLog) {
      return html`<p class="note">${NO_LOG_TEXT}</p>`;
    }
    const gauges = seriesGauges(apexLimitTimeSeries(apexLog));
    if (!gauges.length) {
      return html`<p class="note">${NO_GOVERNOR_USAGE_TEXT}</p>`;
    }

    // A gauge with no reported limit says so on hover, so the strip needs no note beneath it.
    return html`<governor-summary .metrics=${gauges}></governor-summary>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'log-overview': LogOverview;
  }
}
