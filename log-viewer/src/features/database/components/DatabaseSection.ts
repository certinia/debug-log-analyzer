/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// web components
import './DatabaseMetricCard.js';
import type { DatabaseMetric } from './DatabaseMetricCard.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

/**
 * A database section header: a collapsible title row carrying its limit metrics
 * inline as flat stat chips. Clicking the header toggles the section; the host
 * (DatabaseView) owns the accent bar, left inset, collapsed state and the table.
 */
@customElement('database-section')
export class DatabaseSection extends LitElement {
  /** Short section name, e.g. `DML`. */
  @property({ type: String })
  title = '';

  @property({ type: Boolean, reflect: true })
  collapsed = false;

  @property({ attribute: false })
  metrics: DatabaseMetric[] = [];

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
      }

      .header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px 18px;
        width: 100%;
        box-sizing: border-box;
        /* Accent bar lives on the header only; the 12px inset puts the title on
           the same 15px edge as the toolbar and table below. */
        padding: 8px 6px 8px 12px;
        background: none;
        border: none;
        border-left: 3px solid var(--accent, transparent);
        color: inherit;
        cursor: pointer;
        text-align: left;
      }

      .header:hover {
        background: var(--vscode-list-hoverBackground);
      }

      .title-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .chevron {
        flex: 0 0 auto;
        color: var(--vscode-descriptionForeground);
        transition: transform 150ms ease;
      }

      :host([collapsed]) .chevron {
        transform: rotate(-90deg);
      }

      .title {
        font-weight: 600;
        font-size: 1.05rem;
        letter-spacing: 0.02em;
      }

      .metrics {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 18px;
      }

      @media (prefers-reduced-motion: reduce) {
        .chevron {
          transition: none;
        }
      }
    `,
  ];

  render() {
    return html`<button class="header" aria-expanded="${!this.collapsed}" @click="${this._toggle}">
      <span class="title-group">
        <svg
          class="chevron"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <span class="title">${this.title}</span>
      </span>
      <span class="metrics"
        >${this.metrics.map(
          (metric) => html`<database-metric-card .metric="${metric}"></database-metric-card>`,
        )}</span
      >
    </button>`;
  }

  private _toggle() {
    this.dispatchEvent(
      new CustomEvent('section-toggle', {
        bubbles: true,
        composed: true,
        detail: { collapsed: !this.collapsed },
      }),
    );
  }
}
