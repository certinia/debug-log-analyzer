/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  SOQLExecuteBeginLine,
  type GovernorLimits,
  type LogEvent,
  type SelfTotal,
} from 'apex-log-parser';
import { consume } from '@lit/context';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { DEFAULT_NAMESPACE, getCallerNamespace } from '../core/utility/CallerNamespace.js';
import { formatMs } from '../core/utility/Duration.js';
import { formatInteger } from '../core/utility/Util.js';
import { SOSL_ROWS_PER_QUERY_LIMIT } from '../features/database/limits.js';
import { globalStyles } from '../styles/global.styles.js';

// web components
import './CodeBlock.js';
import type { CodeLanguage } from './CodeBlock.js';

/** Times in the inspector are exact to 3dp; the grids stay at 2dp. */
const MS_PRECISION = 3;

/** Salesforce's own definitions, shown on hover so the label needn't explain itself. */
const CARDINALITY_DOC =
  'The estimated number of records that the leading operation type would return \u2014 for example, the number of records returned if using an index table.';
const SOBJECT_CARDINALITY_DOC = 'The approximate record count for the queried object.';

interface Metric {
  label: string;
  pick: (event: LogEvent) => SelfTotal;
  /** The transaction limit this metric accumulates against; 0 when it has none. */
  limit: (limits: GovernorLimits, type?: 'dml' | 'soql' | 'sosl') => number;
  bytes?: boolean;
  /** Throws only ever records on the leaf, so its self reading is meaningless. */
  hasSelf?: boolean;
}

/**
 * Every governor-tracked metric a frame reports, most important first. The
 * `limit` is the row's denominator, so a metric is shown once — never as both a
 * count and a separate "limit" row.
 */
const METRICS: Metric[] = [
  { label: 'SOQL', pick: (e) => e.soqlCount, limit: (l) => l.soqlQueries.limit },
  { label: 'SOQL Rows', pick: (e) => e.soqlRowCount, limit: (l) => l.queryRows.limit },
  { label: 'DML', pick: (e) => e.dmlCount, limit: (l) => l.dmlStatements.limit },
  { label: 'DML Rows', pick: (e) => e.dmlRowCount, limit: (l) => l.dmlRows.limit },
  { label: 'SOSL', pick: (e) => e.soslCount, limit: (l) => l.soslQueries.limit },
  {
    label: 'SOSL Rows',
    pick: (e) => e.soslRowCount,
    // SOSL rows have no transaction total — the 2,000 cap is per query, so it
    // only reads as a limit when a single SOSL statement is selected.
    limit: (_limits, type) => (type === 'sosl' ? SOSL_ROWS_PER_QUERY_LIMIT : 0),
  },
  { label: 'Throws', pick: (e) => e.thrownCount, limit: () => 0, hasSelf: false },
  { label: 'Heap net', pick: (e) => e.heapAllocated, limit: () => 0, bytes: true },
  { label: 'Heap alloc', pick: (e) => e.heapGross, limit: () => 0, bytes: true },
];

/**
 * The details readout for a selection, on every tab. Shows the frame's text
 * (copyable) then every field it actually has — timing, database counts, heap,
 * governor usage, source — in a fixed order, omitting anything zero/absent so a
 * simple selection stays short. `type` adds the DML/SOQL/SOSL specifics; a set of
 * `instances` (an aggregate row's occurrences) switches to summed-across-calls.
 */
@customElement('event-vitals')
export class EventVitals extends LitElement {
  @property({ type: Number })
  eventIndex = -1;

  /** Occurrence eventIndexes when the selection is an aggregate row. */
  @property({ attribute: false })
  instances: number[] | null = null;

  /** Display label for an aggregate selection (the merged frame's name). */
  @property({ type: String })
  label = '';

  /** Set for a Database-grid selection; adds the statement-specific rows. */
  @property({ type: String })
  type?: 'dml' | 'soql' | 'sosl';

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }
      code-block {
        margin-bottom: var(--lana-space-sm);
      }
      /* Label/value pairs stack when narrow and become two aligned columns when
         there's room; the grid owns the columns so subgrid rows line up. */
      .grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--lana-space-sm) var(--lana-space-md);
      }
      .row {
        display: grid;
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
        row-gap: var(--lana-space-3xs);
      }
      @container (min-width: 240px) {
        .grid {
          grid-template-columns: max-content minmax(0, 1fr);
        }
        .row {
          align-items: baseline;
        }
      }
      .label {
        color: var(--lana-fg-muted);
      }
      .value {
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      /* Secondary readings (a percentage, a self time, a query cost) sit in
         brackets one step down in size so the primary number still leads. The
         colour is the theme's own secondary token — not a lower alpha — because
         thinning contrast to de-emphasise costs legibility. */
      .qualifier {
        color: var(--lana-fg-muted);
        font-size: 0.9em;
      }
      .pill {
        display: inline-block;
        padding: 0 var(--lana-space-sm);
        border-radius: var(--lana-radius-sm);
        font-size: 0.85em;
        line-height: 1.4;
        color: var(--lana-editor-bg);
      }
      .pill--yes {
        background-color: var(--vscode-charts-green, #388a34);
      }
      .pill--no {
        background-color: var(--vscode-charts-red, #d13438);
      }
      .empty {
        color: var(--lana-fg-muted);
      }
    `,
  ];

  render() {
    const store = this.logStore;
    if (!store) {
      return html`<div class="empty">No details available.</div>`;
    }

    const events = (this.instances?.length ? this.instances : [this.eventIndex])
      .map((i) => store.eventByIndex(i))
      .filter((e): e is LogEvent => e !== null);
    const primary = events[0];
    if (!primary) {
      return html`<div class="empty">No details available.</div>`;
    }
    const isAggregate = (this.instances?.length ?? 0) > 0;

    const rows: TemplateResult[] = [];
    this._row(rows, 'Type', primary.type ?? '—');
    if (isAggregate) {
      this._row(rows, 'Calls', formatInteger(events.length));
    }

    // Aggregates sum their occurrences; a single frame reports its own timing.
    // Total and self read together, so they share one row.
    const total = events.reduce((sum, e) => sum + e.duration.total, 0);
    const self = events.reduce((sum, e) => sum + e.duration.self, 0);
    this._row(rows, 'Time', html`${this._ms(total)}${qualifier(`self ${this._ms(self)}`)}`);
    if (isAggregate) {
      this._row(rows, 'Avg', this._ms(total / events.length));
    }

    this._metricRows(rows, events);
    this._statementRows(rows, primary);

    this._row(rows, 'Namespace', primary.namespace || '—');
    // Only worth a row when it says something new: "who called this" differing
    // from "whose code ran" is the interesting case (a package's code invoked
    // from another package's trigger). Both normalize empty the same way.
    const callerNamespace = getCallerNamespace(primary);
    if (callerNamespace !== (primary.namespace || DEFAULT_NAMESPACE)) {
      this._row(rows, 'Caller namespace', callerNamespace);
    }
    this._optional(rows, 'Line', primary.lineNumber);

    return html`
      <code-block language=${this._language()} .code=${this.label || primary.text}></code-block>
      <div class="grid">${rows}</div>
    `;
  }

  /**
   * The SOQL query plan the optimizer chose. The leading operation, object and
   * indexed fields are one fact (the parser splits them out of a single
   * `Index on Account : [Id], cardinality: …` line) so they read as one row; the
   * two cardinalities keep Salesforce's own names — matching the SOQL grid's
   * columns — with the docs' definition on hover, since "rows" alone would not
   * say *whose* rows. Row counts are not repeated here: {@link _metricRows}
   * already reports them against their limit.
   */
  private _statementRows(rows: TemplateResult[], event: LogEvent): void {
    if (this.type !== 'soql' || !(event instanceof SOQLExecuteBeginLine)) {
      return;
    }
    const explain = event.children[0];
    this._row(rows, 'Selective', this._selectivityPill(explain?.relativeCost ?? null));
    if (explain) {
      const plan = [
        explain.leadingOperationType,
        explain.sObjectType && `on ${explain.sObjectType}`,
        explain.fields?.length && `[${explain.fields.join(', ')}]`,
      ]
        .filter(Boolean)
        .join(' ');
      this._optional(rows, 'Query plan', plan);
      this._optional(rows, 'Cardinality', explain.cardinality, formatInteger, CARDINALITY_DOC);
      this._optional(
        rows,
        'SObject cardinality',
        explain.sObjectCardinality,
        formatInteger,
        SOBJECT_CARDINALITY_DOC,
      );
    }
    this._optional(rows, 'Aggregations', event.aggregations, formatInteger);
  }

  /**
   * One row per metric the grids expose as columns, so hiding a column never
   * hides the data. Each reads `used / limit (self: n) pct%` — the denominator
   * *is* the governor limit, so usage and limit are never reported twice.
   * Metrics with no transaction limit show the count alone. Zero rows are
   * omitted; `self` only appears when it adds something.
   */
  private _metricRows(rows: TemplateResult[], events: LogEvent[]): void {
    const limits = this.logStore?.log.governorLimits;
    // Aggregates sum their occurrences, matching how the grids aggregate a row.
    const sum = (pick: (e: LogEvent) => SelfTotal, part: 'total' | 'self') =>
      events.reduce((acc, e) => acc + pick(e)[part], 0);

    // A statement's own row count is its headline number, so it shows even at
    // zero ("returned nothing" is a result); other zero metrics stay hidden.
    const alwaysShow = this.type ? `${this.type.toUpperCase()} Rows` : '';

    for (const metric of METRICS) {
      const total = sum(metric.pick, 'total');
      if (!total && metric.label !== alwaysShow) {
        continue;
      }
      const limit = limits ? metric.limit(limits, this.type) : 0;
      const self = metric.hasSelf === false ? 0 : sum(metric.pick, 'self');
      const format = metric.bytes ? formatBytes : formatInteger;
      this._row(
        rows,
        metric.label,
        usage(total, limit, format, self > 0 && self !== total ? format(self) : null),
      );
    }

    // Heap peak is the limit-comparable heap figure and has no self component.
    const heapPeak = events.reduce((max, e) => Math.max(max, e.heapPeak), 0);
    if (heapPeak) {
      this._row(rows, 'Heap peak', usage(heapPeak, limits?.heapSize.limit ?? 0, formatBytes, null));
    }
  }

  private _language(): CodeLanguage {
    return this.type === 'soql' ? 'soql' : this.type === 'sosl' ? 'sosl' : 'plain';
  }

  private _ms(ns: number): string {
    return `${formatMs(ns, MS_PRECISION)} ms`;
  }

  private _row(rows: TemplateResult[], label: string, value: unknown, tooltip?: string) {
    rows.push(
      html`<div class="row">
        <span class="label" title=${ifDefined(tooltip)}>${label}</span
        ><span class="value">${value}</span>
      </div>`,
    );
  }

  /** Adds the row only when the value carries information (non-zero, non-empty). */
  private _optional(
    rows: TemplateResult[],
    label: string,
    value: number | string | null | undefined,
    format: (value: number) => string = String,
    tooltip?: string,
  ) {
    if (value === null || value === undefined || value === '' || value === 0) {
      return;
    }
    this._row(rows, label, typeof value === 'number' ? format(value) : value, tooltip);
  }

  private _selectivityPill(relativeCost: number | null) {
    if (relativeCost === null || relativeCost === undefined) {
      return html`<span class="value">Unknown</span>`;
    }
    const cost = qualifier(`cost ${relativeCost}`);
    return relativeCost <= 1
      ? html`<span class="pill pill--yes">Selective</span>${cost}`
      : html`<span class="pill pill--no">Not selective</span>${cost}`;
  }
}

/** Heap values are byte counts; a signed net value keeps its sign. */
function formatBytes(bytes: number): string {
  return `${formatInteger(bytes)} bytes`;
}

/**
 * Secondary readings for a value, in a single bracketed group one step down in
 * size — never several adjacent brackets, which collide as `) (`. The leading
 * space is in the markup (not a margin) so copied text reads correctly.
 */
function qualifier(...parts: Array<string | false | null | undefined>): TemplateResult | string {
  const shown = parts.filter((part): part is string => !!part);
  return shown.length ? html` <span class="qualifier">(${shown.join(', ')})</span>` : '';
}

/**
 * `used / limit` followed by its derived percentage and any self reading, so the
 * primary number reads first. Without a known limit there is no denominator and
 * no percentage.
 */
function usage(
  total: number,
  limit: number,
  format: (value: number) => string,
  self: string | null,
): TemplateResult {
  const primary = limit > 0 ? `${format(total)} / ${format(limit)}` : format(total);
  // Percentage first: it qualifies the ratio immediately before it.
  const percent = limit > 0 ? `${((total / limit) * 100).toFixed(2)}%` : null;
  return html`${primary}${qualifier(percent, self && `self ${self}`)}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'event-vitals': EventVitals;
  }
}
