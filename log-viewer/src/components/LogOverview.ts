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
import {
  ESTIMATED_LIMITS_TEXT,
  NO_CUMULATIVE_LIMITS_TEXT,
  seriesGauges,
} from './logOverviewMetrics.js';

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
        font-size: var(--lana-text-sm);
      }
    `,
  ];

  render() {
    const apexLog = this.logStore?.log;
    const gauges = apexLog ? seriesGauges(apexLimitTimeSeries(apexLog)) : [];
    if (!apexLog || !gauges.length) {
      return html`<p class="note">${NO_CUMULATIVE_LIMITS_TEXT}</p>`;
    }

    // Snapshots correct the series where they exist; without any, the figures
    // are estimated from granular events — say so.
    const estimated = apexLog.governorLimits.snapshots.length === 0;
    return html`<governor-summary .metrics=${gauges}></governor-summary>
      ${estimated ? html`<p class="note">${ESTIMATED_LIMITS_TEXT}</p>` : ''}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'log-overview': LogOverview;
  }
}
