/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { DetailSource } from '../core/events/EventBus.js';
import { eventBus } from '../core/events/EventBus.js';
import type { GaugeMetric } from '../features/database/components/GovernorSummary.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
import { globalStyles } from '../styles/global.styles.js';
import { emptyTextFor } from './detailEmptyText.js';
import { tightestGauges } from './logOverviewMetrics.js';

// web components
import '../features/database/components/GovernorSummary.js';

/**
 * The inspector's whole-log section, shown while nothing is selected: the
 * governor metrics nearest a limit, plus the hint that names what to select for
 * a scoped read. The hint lives here because every source now returns a section,
 * so `DetailDock`'s own empty text only shows before a tab id resolves.
 *
 * Log size and duration are deliberately absent — `LogMeta` heads the app with
 * both.
 */
@customElement('log-overview')
export class LogOverview extends LitElement {
  /** The tab the inspector follows, which decides the selection hint. */
  @property({ type: String })
  source: DetailSource | undefined;

  private _offLogLoaded: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    // The inspector paints before the first log is parsed, and it rebuilds only
    // on a tab change or a selection — so the gauges have to follow the log
    // themselves.
    this._offLogLoaded = eventBus.on('log:loaded', () => this.requestUpdate());
  }

  override disconnectedCallback() {
    this._offLogLoaded?.();
    this._offLogLoaded = null;
    super.disconnectedCallback();
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
      }

      .note,
      .hint {
        /* Left inset lines the text up with the gauge strip's labels. */
        padding: var(--lana-space-sm) var(--lana-space-md) 0 var(--lana-section-inset);
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }

      .hint {
        padding-bottom: var(--lana-space-md);
      }
    `,
  ];

  render() {
    const gauges = this._gauges();
    return html`
      ${
        gauges.length
          ? html`<governor-summary .metrics=${gauges}></governor-summary>`
          : html`<p class="note">
              This log has no cumulative limit usage, so governor totals are unknown.
            </p>`
      }
      <p class="hint">${emptyTextFor(this.source)}</p>
    `;
  }

  private _gauges(): GaugeMetric[] {
    const limits = DatabaseAccess.instance()?.getApexLog()?.governorLimits;
    return limits ? tightestGauges(limits) : [];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'log-overview': LogOverview;
  }
}
