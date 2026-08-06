/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { dispatchInspectorReveal } from '../../../components/inspectorReveal.js';
import { eventBus } from '../../../core/events/EventBus.js';
import { globalStyles } from '../../../styles/global.styles.js';
import { bleedRowStyles } from '../../../styles/revealRow.styles.js';
import { severityIcon, severityStyles } from '../../../styles/severity.styles.js';
import {
  computeLogDiagnostics,
  type Diagnostic,
  type LogDiagnostics,
} from '../services/LogDiagnostics.js';

/**
 * The Analysis tab's whole-log findings: what the log says is slow or wrong, and
 * what to do about it. The list is the shape every comparable tool uses for this.
 *
 * Two absences are reported rather than hidden. A truncated log makes every
 * figure below it an undercount, so it heads the pane; and without FINEST
 * database logging there are no query plans, which says nothing about the
 * queries — so the pane says the verdicts are unknown instead of leaving them
 * looking clean.
 */
@customElement('log-diagnostics')
export class LogDiagnosticsView extends LitElement {
  @state()
  private _result: LogDiagnostics | null = null;

  private _offLogLoaded: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    void this._analyse();
    // The inspector paints before the first log is parsed, and it rebuilds only
    // on a tab change or a selection.
    this._offLogLoaded = eventBus.on('log:loaded', () => void this._analyse());
  }

  override disconnectedCallback() {
    this._offLogLoaded?.();
    this._offLogLoaded = null;
    super.disconnectedCallback();
  }

  static styles = [
    globalStyles,
    severityStyles,
    bleedRowStyles,
    css`
      :host {
        display: block;
      }

      /* One finding is one row: a fixed-height line that never reflows the list,
         with the detail behind a disclosure. The severity glyph leads, the title
         takes the slack, and the meta, count and chevron flow into their own
         columns — absent ones leave no empty track. */
      summary {
        display: grid;
        grid-auto-flow: column;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        column-gap: var(--lana-space-2xs);
      }

      /* The chevron replaces the native marker, so every row shows it can open. */
      summary::marker,
      summary::-webkit-details-marker {
        content: '';
        display: none;
      }

      .chevron {
        color: var(--lana-fg-muted);
        transition: transform 0.1s ease-out;
      }

      details[open] .chevron {
        transform: rotate(90deg);
      }

      /* The summary states the problem; the figure behind it and the count are
         metadata, so they sit right and do not push the title around. */
      .title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .meta {
        color: var(--lana-fg-muted);
        font-family: var(--lana-font-mono);
        font-size: var(--lana-text-sm);
        font-variant-numeric: tabular-nums;
      }

      /* How many events raised the finding, as a count badge. */
      .count {
        min-width: 1.4em;
        border-radius: var(--lana-radius-md);
        padding: 0 var(--lana-space-2xs);
        background-color: var(--lana-badge-bg);
        color: var(--lana-badge-fg);
        font-size: var(--lana-text-sm);
        font-variant-numeric: tabular-nums;
        text-align: center;
      }

      /* A rail threads the detail back to its row's severity glyph. */
      .body {
        margin: 0 0 var(--lana-space-sm) var(--lana-space-2xs);
        border-left: var(--lana-stroke) solid var(--lana-surface-border);
        padding-left: calc(var(--lana-space-lg) + var(--lana-space-2xs));
      }

      .detail {
        margin: 0;
        color: var(--lana-fg-muted);
      }

      /* What is behind the finding, as a figure row: a quiet label, the code the
         log named, then its figures held to the right edge so the eye reads the
         names down the pane and the numbers up the right of it. The label is the
         one part that never wraps away from the name. */
      .cause {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--lana-space-2xs) var(--lana-space-sm);
        margin: var(--lana-space-xs) 0 0;
      }

      .cause__label {
        flex: 0 0 auto;
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }

      .cause__name {
        flex: 1 1 auto;
        min-width: 0;
        font-family: var(--lana-font-mono);
        font-size: var(--lana-text-sm);
        overflow-wrap: anywhere;
      }

      .cause__value {
        flex: 0 0 auto;
        margin-left: auto;
        color: var(--vscode-foreground);
        font-family: var(--lana-font-mono);
        font-size: var(--lana-text-sm);
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }

      /* The line the finding points at: the statement it read, or the frame the
         transaction stopped on. A code surface, so it reads as the log's own words
         and not as more of the prose above it. */
      .evidence {
        display: flex;
        align-items: flex-start;
        gap: var(--lana-space-xs);
        width: 100%;
        margin: var(--lana-space-xs) 0 0;
        border: var(--lana-stroke) solid var(--lana-surface-border);
        border-radius: var(--lana-radius-sm);
        padding: var(--lana-space-2xs) var(--lana-space-xs);
        background-color: var(--lana-code-bg);
        color: var(--vscode-foreground);
        font-family: var(--lana-font-mono);
        font-size: var(--lana-text-sm);
        text-align: left;
      }

      .evidence__text {
        flex: 1 1 auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      /* The evidence names one event, so it is the way back to that row. */
      .evidence--link {
        cursor: pointer;
      }

      .evidence--link:hover {
        border-color: var(--vscode-focusBorder);
        background-color: var(--lana-row-hover-bg);
      }

      .evidence--link:focus-visible {
        outline: var(--lana-stroke) solid var(--vscode-focusBorder);
        outline-offset: var(--lana-stroke);
      }

      .evidence__go {
        flex: 0 0 auto;
        color: var(--lana-fg-muted);
      }

      .evidence--link:hover .evidence__go {
        color: var(--vscode-foreground);
      }

      .note {
        padding: var(--lana-space-sm) var(--lana-space-2xs);
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }

      .truncated {
        color: var(--lana-severity-warning);
      }
    `,
  ];

  render() {
    const result = this._result;
    if (!result) {
      return html`<p class="note">Analysing the log…</p>`;
    }

    return html`
      ${result.truncation ? html`<p class="note truncated">${result.truncation}</p>` : ''}
      ${
        result.diagnostics.length
          ? result.diagnostics.map((diagnostic) => {
              const severity = diagnostic.severity.toLowerCase();
              return html`<details>
                <summary class="bleed-row">
                  <vscode-icon
                    class="sev-${severity}"
                    name=${severityIcon(diagnostic.severity)}
                  ></vscode-icon>
                  <span class="title" title=${diagnostic.summary}>${diagnostic.summary}</span>
                  ${diagnostic.meta ? html`<span class="meta">${diagnostic.meta}</span>` : ''}
                  ${
                    diagnostic.count > 1 ? html`<span class="count">${diagnostic.count}</span>` : ''
                  }
                  <vscode-icon class="chevron" name="chevron-right"></vscode-icon>
                </summary>
                <div class="body">
                  ${diagnostic.message ? html`<p class="detail">${diagnostic.message}</p>` : ''}
                  ${this._cause(diagnostic.cause)} ${this._evidence(diagnostic)}
                </div>
              </details>`;
            })
          : html`<p class="note">No findings.</p>`
      }
      ${this._caveats(result).map((caveat) => html`<p class="note">${caveat}</p>`)}
    `;
  }

  /** The one thing behind the finding, when the log named one. */
  private _cause(cause: Diagnostic['cause']) {
    if (!cause) {
      return '';
    }
    return html`<div class="cause">
      <span class="cause__label">${cause.label}</span>
      <span class="cause__name">${cause.name}</span>
      <span class="cause__value">${cause.value}</span>
    </div>`;
  }

  /**
   * The log line behind the finding. A log-wide finding names no single event, so
   * that one is text only; every other one is the way back to its row in the grid.
   */
  private _evidence(diagnostic: Diagnostic) {
    if (!diagnostic.evidence) {
      return '';
    }
    const text = html`<span class="evidence__text">${diagnostic.evidence}</span>`;
    if (diagnostic.eventIndex < 0) {
      return html`<div class="evidence">${text}</div>`;
    }
    return html`<button
      class="evidence evidence--link"
      type="button"
      title="Show this in the grid"
      @click=${() => dispatchInspectorReveal(this, diagnostic.eventIndex)}
    >
      ${text}
      <vscode-icon class="evidence__go" name="arrow-right"></vscode-icon>
    </button>`;
  }

  /** What the log could not answer, so no absent data reads as a clean result. */
  private _caveats(result: LogDiagnostics): string[] {
    const caveats: string[] = [];
    if (!result.queryPlansKnown) {
      caveats.push(
        'This log holds no query plans, so how selective the queries are is unknown. Re-run with the Database log level at FINEST to see them.',
      );
    }
    const { linted, distinct } = result.lintedQueries;
    if (linted < distinct) {
      caveats.push(
        `The SOQL rules cover the ${linted} most repeated of ${distinct} distinct queries.`,
      );
    }
    return caveats;
  }

  private async _analyse(): Promise<void> {
    this._result = null;
    this._result = await computeLogDiagnostics();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'log-diagnostics': LogDiagnosticsView;
  }
}
