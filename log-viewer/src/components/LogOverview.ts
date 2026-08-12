/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { LogLoadedController } from '../core/events/LogLoadedController.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
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
  /** The gauges have to follow the log itself. */
  private readonly _logLoaded = new LogLoadedController(this);

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
    const apexLog = DatabaseAccess.instance()?.getApexLog();
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
