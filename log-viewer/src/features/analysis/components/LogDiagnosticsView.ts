/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { dispatchInspectorReveal } from '../../../components/inspectorReveal.js';
import { eventBus } from '../../../core/events/EventBus.js';
import { formatSOQLToTemplate } from '../../soql/format/formatter.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';
import { globalStyles } from '../../../styles/global.styles.js';
import { bleedRowStyles } from '../../../styles/revealRow.styles.js';
import { severityIcon, severityStyles } from '../../../styles/severity.styles.js';
import {
  computeLogDiagnostics,
  type Diagnostic,
  type DiagnosticEvidence,
  type LogDiagnostics,
} from '../services/LogDiagnostics.js';

/**
 * Lines a listed query gets. A clause takes a line, so this is what decides how
 * far down the query the render reaches: below four, `FROM` and `WHERE` give way
 * to a `+N clauses` marker and the statement is no longer recognisable.
 */
const EVIDENCE_LINES = 4;

/** Characters per line where the pane has no layout to measure. */
const FALLBACK_COLUMNS = 60;

const PROBE_TEXT = 'SELECT0123456789';

const textWidth = document.createElement('canvas').getContext('2d');

/** A character of the element's own font, so a wider dock shows more of a query. */
function charWidthOf(element: HTMLElement): number {
  if (!textWidth) {
    return 0;
  }
  const style = getComputedStyle(element);
  textWidth.font = `${style.fontSize} ${style.fontFamily}`;
  return textWidth.measureText(PROBE_TEXT).width / PROBE_TEXT.length;
}

/**
 * The Analysis tab's whole-log findings: what the log says is slow or wrong, and
 * what to do about it. The list is the shape every comparable tool uses for this.
 *
 * An absence is reported rather than hidden: without FINEST database logging
 * there are no query plans, which says nothing about the queries — so the pane
 * says the verdicts are unknown instead of leaving them looking clean.
 */
@customElement('log-diagnostics')
export class LogDiagnosticsView extends LitElement {
  @state()
  private _result: LogDiagnostics | null = null;

  private _offLogLoaded: (() => void) | null = null;

  private _columns = FALLBACK_COLUMNS;

  private _resize: ResizeObserver | null = null;

  override connectedCallback() {
    super.connectedCallback();
    void this._analyse();
    // The inspector paints before the first log is parsed, and it rebuilds only
    // on a tab change or a selection.
    this._offLogLoaded = eventBus.on('log:loaded', () => void this._analyse());
    if (typeof ResizeObserver !== 'undefined') {
      this._resize = new ResizeObserver(() => this._measure());
      this._resize.observe(this);
    }
  }

  override disconnectedCallback() {
    this._offLogLoaded?.();
    this._offLogLoaded = null;
    this._resize?.disconnect();
    this._resize = null;
    super.disconnectedCallback();
  }

  override updated() {
    this._measure();
  }

  /** Fit the listed queries to the pane, from a line already on screen. */
  private _measure(): void {
    const line = this.shadowRoot?.querySelector<HTMLElement>('.evidence__text--code');
    if (!line) {
      return;
    }
    const charWidth = charWidthOf(line);
    const columns = charWidth ? Math.floor(line.clientWidth / charWidth) : 0;
    if (columns > 0 && columns !== this._columns) {
      this._columns = columns;
      this.requestUpdate();
    }
  }

  static styles = [
    globalStyles,
    severityStyles,
    bleedRowStyles,
    unsafeCSS(soqlSyntaxStyles),
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

      /* A clause per line, cut at the same count the budget renders, so a wrapped
         clause cannot push the list apart. The whole statement is one click away. */
      .evidence__text--code {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 4;
        line-clamp: 4;
        min-width: 0;
        overflow: hidden;
      }

      /* How many lines the finding has, when it lists only the most repeated. */
      .evidence__head {
        margin: var(--lana-space-sm) 0 0;
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }

      /* How many times this one line ran. */
      .evidence__count {
        flex: 0 0 auto;
        color: var(--lana-fg-muted);
        font-variant-numeric: tabular-nums;
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
    `,
  ];

  render() {
    const result = this._result;
    if (!result) {
      return html`<p class="note">Analysing the log…</p>`;
    }

    return html`
      ${this._caveats(result).map((caveat) => html`<p class="note">${caveat}</p>`)}
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
   * The log lines behind the finding — one for most, one per statement for a
   * finding about a query written several ways. A line that names no single event
   * is text only; every other one is the way back to its row in the grid.
   */
  private _evidence(diagnostic: Diagnostic) {
    const evidence = diagnostic.evidence ?? [];
    const total = diagnostic.evidenceTotal ?? 0;
    return [
      total > evidence.length
        ? html`<p class="evidence__head">
            ${evidence.length} of ${total} statements, most repeated first.
          </p>`
        : '',
      ...evidence.map((line) => this._evidenceLine(line)),
    ];
  }

  private _evidenceLine({ text, eventIndex, count, dialect }: DiagnosticEvidence) {
    const body = dialect
      ? html`<span class="evidence__text evidence__text--code soql-block"
          >${formatSOQLToTemplate(text, {
            mode: 'pretty',
            dialect,
            budget: { lines: EVIDENCE_LINES, columns: this._columns },
          })}</span
        >`
      : html`<span class="evidence__text">${text}</span>`;
    const ran = count && count > 1 ? html`<span class="evidence__count">${count}×</span>` : '';
    if (eventIndex < 0) {
      return html`<div class="evidence" title=${text}>${body}${ran}</div>`;
    }
    return html`<button
      class="evidence evidence--link"
      type="button"
      title=${text}
      @click=${() => dispatchInspectorReveal(this, eventIndex)}
    >
      ${body}${ran}
      <vscode-icon class="evidence__go" name="arrow-right"></vscode-icon>
    </button>`;
  }

  /** What the log could not answer, so no absent data reads as a clean result. */
  private _caveats(result: LogDiagnostics): string[] {
    const caveats: string[] = [];
    if (!result.queryPlansKnown) {
      caveats.push(
        'To see query plan findings, re-run the log with the Database log level at FINEST.',
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
