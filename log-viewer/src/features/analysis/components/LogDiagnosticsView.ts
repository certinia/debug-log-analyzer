/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { dispatchInspectorReveal } from '../../../components/inspectorReveal.js';
import { eventBus } from '../../../core/events/EventBus.js';
import { formatDuration } from '../../../core/utility/Util.js';
import { formatSOQLToTemplate } from '../../soql/format/formatter.js';
import { SEVERITY_TYPES, type Severity } from '../../soql/services/SOQLLinter.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';
import { globalStyles } from '../../../styles/global.styles.js';
import { bleedRowStyles } from '../../../styles/revealRow.styles.js';
import { severityIcon, severityStyles } from '../../../styles/severity.styles.js';
import {
  computeLogDiagnostics,
  scopeDiagnostics,
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

/** Below this a share reads as 0%, which is not what a measured finding says. */
const MIN_SHARE = 0.01;

/**
 * The Analysis tab's findings: what the log says is slow or wrong, and what to do
 * about it. The list is the shape every comparable tool uses for this.
 *
 * With {@link instances} set the same findings re-scope to one method — which of
 * them name it or anything it called — so the pane answers what the grid beside
 * it cannot: whether the row the reader picked is one of the log's problems.
 *
 * An absence is reported rather than hidden: without FINEST database logging
 * there are no query plans, which says nothing about the queries — so the pane
 * says the verdicts are unknown instead of leaving them looking clean.
 */
@customElement('log-diagnostics')
export class LogDiagnosticsView extends LitElement {
  /** The selected method's occurrences, or null for the whole log. */
  @property({ attribute: false })
  instances: readonly number[] | null = null;

  /** The whole log's findings, before any scoping. */
  @state()
  private _all: LogDiagnostics | null = null;

  /** Which severities the roll-up bar is holding the list to. Empty is all. */
  @state()
  private _filters: readonly Severity[] = [];

  /**
   * The findings whose detail is open. A closed finding renders no body, so the
   * statements it lists are never formatted — a finding can list every statement
   * behind it because only the open ones cost anything.
   */
  @state()
  private _open: ReadonlySet<string> = new Set();

  /** {@link _all}, narrowed to {@link instances}. */
  private _result: LogDiagnostics | null = null;

  /** The occurrences {@link _result} was scoped to. See {@link willUpdate}. */
  private _scope = '';

  /** The findings {@link _result} was scoped from. */
  private _scoped: LogDiagnostics | null = null;

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

  override willUpdate() {
    // Keyed on the occurrences themselves: the host builds the array in its own
    // render, so its identity changes even when the selection has not.
    const scope = this.instances?.join(',') ?? '';
    const moved = scope !== this._scope;
    if (moved) {
      // A new selection is a new list, so a severity held from the last one would
      // hide findings the reader has not seen.
      this._scope = scope;
      this._filters = [];
      this._open = new Set();
    }
    if (moved || this._all !== this._scoped) {
      this._scoped = this._all;
      this._result =
        this._all && this.instances ? scopeDiagnostics(this._all, this.instances) : this._all;
    }
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

      /* The findings by severity, as a row of toggles: how the list is made up, and
         the filter for it. Each is only as wide as it needs to be, all the same
         width, so the counts are read as counts and not as widths. */
      .rollup {
        display: flex;
        flex-wrap: wrap;
        gap: var(--lana-space-3xs);
        margin: var(--lana-space-2xs) 0 var(--lana-space-xs);
      }

      /* Chrome stays neutral and colour stays on the glyph, so a pressed segment
         reads as pressed rather than as a more severe one. */
      .rollup__seg {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--lana-space-3xs);
        flex: 0 0 auto;
        min-width: 3.5em;
        border: var(--lana-stroke) solid var(--lana-surface-border);
        border-radius: var(--lana-radius-sm);
        padding: var(--lana-space-3xs) var(--lana-space-2xs);
        background-color: transparent;
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        transition:
          background-color 0.15s ease-out,
          border-color 0.15s ease-out;
      }

      .rollup__seg:hover {
        background-color: var(--lana-row-hover-bg);
      }

      .rollup__seg[aria-pressed='true'] {
        border-color: var(--lana-fg-muted);
        background-color: var(--lana-code-bg);
        color: var(--lana-fg);
      }

      .rollup__seg:focus-visible {
        outline: var(--lana-stroke) solid var(--vscode-focusBorder);
        outline-offset: var(--lana-stroke);
      }

      /* How long the finding's own events took, and what that is of the log. Only
         the findings the log times carry one. */
      .share {
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      /* Nothing wrong is a result too, so it is stated rather than left blank. */
      .ok {
        display: flex;
        align-items: center;
        gap: var(--lana-space-xs);
        padding: var(--lana-space-sm) var(--lana-space-2xs);
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }

      /* One finding is one row, with the detail behind a disclosure: the chevron and
         severity glyph lead, the title takes the slack and truncates, and the
         figures hold the right. The row stays one line at any width — the title
         gives way rather than the row growing or anything leaving the edge. */
      summary {
        display: flex;
        align-items: center;
        gap: var(--lana-space-2xs);
      }

      .summary__lead {
        display: flex;
        align-items: center;
        gap: var(--lana-space-2xs);
        flex: 1 1 auto;
        min-width: 0;
      }

      .summary__figures {
        display: flex;
        align-items: center;
        gap: var(--lana-space-2xs);
        flex: 0 0 auto;
        margin-left: auto;
      }

      /* The chevron replaces the native marker, so every row shows it can open. */
      summary::marker,
      summary::-webkit-details-marker {
        content: '';
        display: none;
      }

      .chevron {
        flex: 0 0 auto;
        color: var(--lana-fg-muted);
        transition: transform 0.1s ease-out;
      }

      details[open] .chevron {
        transform: rotate(90deg);
      }

      /* The summary states the problem; the figure behind it and the count are
         metadata, so they sit right and do not push the title around. */
      .title {
        min-width: 0;
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

      /* A rail threads the detail back to its row. The inset is small: a narrow dock
         has no width to give away, and the rail already marks the nesting. */
      .body {
        margin: 0 0 var(--lana-space-sm) var(--lana-space-xs);
        border-left: var(--lana-stroke) solid var(--lana-surface-border);
        padding-left: var(--lana-space-sm);
      }

      .detail {
        margin: 0;
        color: var(--lana-fg-muted);
      }

      /* What is behind the finding, as a figure row: a quiet label, the code the
         log named, then its figure held to the right edge so the eye reads the
         names down the pane and the numbers up the right of it. One line at any
         width: the name truncates, and its hover carries the whole of it. */
      .cause {
        display: flex;
        align-items: baseline;
        gap: var(--lana-space-2xs);
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
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--lana-space-3xs) var(--lana-space-xs);
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
        /* The statement is the row's content, so it takes the width and wraps; the
           figures beside it wrap under rather than off the edge. */
        flex: 1 1 12ch;
        min-width: 0;
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
    const scoped = this.instances !== null;
    const filters = this._filters;
    const shown = filters.length
      ? result.diagnostics.filter((diagnostic) => filters.includes(diagnostic.severity))
      : result.diagnostics;

    return html`
      ${
        // A caveat is about the whole log's analysis, so it belongs where the
        // whole log's findings are.
        scoped ? '' : this._caveats(result).map((caveat) => html`<p class="note">${caveat}</p>`)
      }
      ${this._rollup(result.diagnostics)}
      ${
        shown.length
          ? shown.map((diagnostic) => {
              const severity = diagnostic.severity.toLowerCase();
              const key = `${diagnostic.severity}:${diagnostic.summary}`;
              const open = this._open.has(key);
              return html`<details
                ?open=${open}
                @toggle=${(event: Event) =>
                  this._toggle(key, (event.target as HTMLDetailsElement).open)}
              >
                <summary class="bleed-row">
                  <span class="summary__lead">
                    <vscode-icon class="chevron" name="chevron-right"></vscode-icon>
                    <vscode-icon
                      class="sev-${severity}"
                      name=${severityIcon(diagnostic.severity)}
                    ></vscode-icon>
                    <span class="title" title=${diagnostic.summary}>${diagnostic.summary}</span>
                  </span>
                  <span class="summary__figures">
                    ${diagnostic.meta ? html`<span class="meta">${diagnostic.meta}</span>` : ''}
                    ${this._share(diagnostic, result.logNs)}
                    ${
                      diagnostic.count > 1
                        ? html`<span class="count">${diagnostic.count}</span>`
                        : ''
                    }
                  </span>
                </summary>
                ${
                  open
                    ? html`<div class="body">
                        ${
                          diagnostic.message
                            ? html`<p class="detail">${diagnostic.message}</p>`
                            : ''
                        }
                        ${this._cause(diagnostic.cause)} ${this._evidence(diagnostic)}
                      </div>`
                    : ''
                }
              </details>`;
            })
          : html`<p class="ok">
              <vscode-icon class="sev-ok" name="pass"></vscode-icon>
              <span>No findings — you're good to go.</span>
            </p>`
      }
    `;
  }

  /**
   * The findings by severity, as one segmented toggle: how the list is made up, and
   * the filter for it. Any number of severities can be held at once, so the list is
   * their union. One band alone is the list itself, so it is not drawn.
   */
  private _rollup(diagnostics: Diagnostic[]) {
    const bands = SEVERITY_TYPES.map((severity) => ({
      severity,
      count: diagnostics.filter((diagnostic) => diagnostic.severity === severity).length,
    })).filter((band) => band.count > 0);
    if (bands.length < 2) {
      return '';
    }
    return html`<div class="rollup" role="group" aria-label="Findings by severity">
      ${bands.map(({ severity, count }) => {
        const held = this._filters.includes(severity);
        return html`<button
          class="rollup__seg"
          type="button"
          aria-pressed=${held}
          title=${`${count} ${severity} ${count === 1 ? 'finding' : 'findings'}`}
          @click=${() =>
            (this._filters = held
              ? this._filters.filter((each) => each !== severity)
              : [...this._filters, severity])}
        >
          <vscode-icon
            class="sev-${severity.toLowerCase()}"
            name=${severityIcon(severity)}
          ></vscode-icon>
          <span>${count}</span>
        </button>`;
      })}
    </div>`;
  }

  private _toggle(key: string, open: boolean): void {
    const next = new Set(this._open);
    if (open) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this._open = next;
  }

  /**
   * How long the finding's own events took, and what that is of the log. Only the
   * findings the log times carry one: a share invented for an untimed finding would
   * read as a measurement.
   */
  private _share(diagnostic: Diagnostic, logNs: number) {
    const timeNs = diagnostic.timeNs;
    if (!timeNs || logNs <= 0) {
      return '';
    }
    const share = timeNs / logNs;
    const percent = share < MIN_SHARE ? '<1%' : `${Math.round(share * 100)}%`;
    return html`<span class="share"
      >${formatDuration(timeNs, { compact: true })} (${percent})</span
    >`;
  }

  /** The one thing behind the finding, when the log named one. */
  private _cause(cause: Diagnostic['cause']) {
    if (!cause) {
      return '';
    }
    return html`<div class="cause">
      <span class="cause__label">${cause.label}</span>
      <span class="cause__name" title=${cause.name}>${cause.name}</span>
      <span class="cause__value">${cause.value}</span>
    </div>`;
  }

  /**
   * The log lines behind the finding — one for most, every statement for a
   * finding about a query written several ways. A line that names no single event
   * is text only; every other one is the way back to its row in the grid.
   */
  private _evidence(diagnostic: Diagnostic) {
    const evidence = diagnostic.evidence ?? [];
    return [
      evidence.length > 1
        ? html`<p class="evidence__head"> ${evidence.length} statements, most repeated first. </p>`
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
    this._all = null;
    this._all = await computeLogDiagnostics();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'log-diagnostics': LogDiagnosticsView;
  }
}
