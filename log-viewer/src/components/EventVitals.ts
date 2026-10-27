/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent, ApexLog, EventOf } from '@apexdevtools/apex-log-parser';
import { consume } from '@lit/context';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import { describeLevelGap } from '#core/log/levelCapabilities.js';
import { logContext } from '#core/log/logContext.js';
import type { LogStore } from '#core/log/LogStore.js';
import {
  EVENT_METRICS,
  formatBytes,
  HEAP_PEAK,
  selfLabel,
  usageParts,
} from '#core/metrics/eventMetrics.js';
import {
  DEFAULT_NAMESPACE,
  getCallerNamespace,
  namespaceOf,
} from '#core/utility/CallerNamespace.js';
import { formatNsAsMs } from '#core/utility/Duration.js';
import { outermostIds } from '#core/utility/EventTree.js';
import { formatInteger } from '#core/utility/Util.js';
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

  /** The frame that made the calls the panel describes, where the selecting row
   *  was not it. Empty where the row named the calls it counts. */
  @property({ type: String, attribute: 'called-by' })
  calledBy = '';

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
        font-size: var(--lana-text-sm);
      }
      /* One hue carries the verdict through a tinted ground and its edge, as
         SelfTimeSpreadView tints a row from its own hue property. Every variant
         sets the hue; the word reads as the text around it. */
      .pill {
        display: inline-block;
        padding: 0 var(--lana-space-2xs);
        border: var(--lana-stroke) solid color-mix(in srgb, var(--pill-hue) 30%, transparent);
        border-radius: var(--lana-radius-md);
        background-color: color-mix(in srgb, var(--pill-hue) 12%, transparent);
        font-size: var(--lana-text-xs);
        line-height: 1.4;
      }
      .pill--yes {
        --pill-hue: var(--lana-severity-ok);
      }
      .pill--no {
        --pill-hue: var(--lana-severity-warning);
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

    // Ids, not events: an aggregate can name tens of thousands of calls, and the
    // columns read each without an object.
    const ids = (this.instances?.length ? this.instances : [this.eventIndex]).filter((id) =>
      store.isShown(id),
    );
    const primary = ids[0] === undefined ? null : store.log.event(ids[0]);
    if (!primary) {
      return html`<div class="empty">No details available.</div>`;
    }
    const isAggregate = (this.instances?.length ?? 0) > 0;
    const { log } = store;
    const { durationTotal, durationSelf } = log.columns;
    // A total nests and a self reading does not, so each sums the set that holds it once.
    const outer = outermostIds(log, ids);

    const rows: TemplateResult[] = [];
    this._row(rows, 'Type', primary.type);
    if (isAggregate) {
      this._row(rows, 'Calls', formatInteger(ids.length));
    }
    // The panel is titled by the calls it describes, so the frame that made them
    // is a fact beside them rather than the title.
    if (this.calledBy) {
      this._row(rows, 'Called by', this.calledBy);
    }

    // A recursive frame's outer call already holds its inner calls, so a total
    // counts the outermost occurrences only.
    const total = sumOf(outer, durationTotal);
    const self = sumOf(ids, durationSelf);
    this._row(
      rows,
      'Time',
      html`${this._ms(total)}${qualifier(selfLabel(this._ms(self)))}`,
      'Total elapsed time, including nested calls of the same method',
    );
    if (isAggregate) {
      // Self time never nests, so it and the call count cover the same calls.
      this._row(rows, 'Avg self', this._ms(self / ids.length));
    }

    this._metricRows(rows, log, ids, outer);
    this._statementRows(rows, primary);

    this._row(rows, 'Namespace', namespaceOf(store.log, primary.id));
    // Only worth a row when it says something new: "who called this" differing
    // from "whose code ran" is the interesting case (a package's code invoked
    // from another package's trigger). Both normalize empty the same way.
    const callerNamespace = getCallerNamespace(store, primary.id);
    if (callerNamespace !== (primary.namespace || DEFAULT_NAMESPACE)) {
      this._row(rows, 'Caller namespace', callerNamespace);
    }
    // The call site, in the code that contains the frame — not where it is defined.
    this._optional(rows, 'Called from', primary.lineNumber, (line) => `line ${line}`);

    return html`
      <code-block language=${this._language()} .code=${primary.text ?? primary.type}></code-block>
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
  private _statementRows(rows: TemplateResult[], event: ApexEvent): void {
    if (this.type !== 'soql' || event.type !== 'SOQL_EXECUTE_BEGIN') {
      return;
    }
    // The type was checked above.
    const { explain, aggregations } = (event as EventOf<'SOQL_EXECUTE_BEGIN'>).details;
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
    this._optional(rows, 'Aggregations', aggregations, formatInteger);
  }

  /**
   * One row per metric the grids expose as columns, so hiding a column never
   * hides the data. Each reads `used of the log's total (share, limit share, self)` — the
   * denominator is what the transaction consumed, the question a selection is asked, so the row
   * reads on every log whether or not one reported limits. A reported limit follows as a
   * qualifier. Zero rows are omitted; `self` only appears when it adds something.
   */
  private _metricRows(
    rows: TemplateResult[],
    apexLog: ApexLog,
    ids: readonly number[],
    outer: readonly number[],
  ): void {
    const { limits, columns } = apexLog;

    // A statement's own row count is its headline number, so it shows even at
    // zero ("returned nothing" is a result); other zero metrics stay hidden.
    const alwaysShow = this.type ? `${this.type.toUpperCase()} Rows` : '';

    for (const metric of EVENT_METRICS) {
      const column = columns[metric.key];
      const total = column ? sumOf(outer, column.total) : 0;
      if (!total && metric.label !== alwaysShow) {
        continue;
      }
      const limit = metric.limit(limits, this.type);
      const self = metric.noSelf || !column ? 0 : sumOf(ids, column.self);
      const format = metric.bytes ? formatBytes : formatInteger;
      this._row(
        rows,
        metric.label,
        usage(
          total,
          metric.pick(apexLog).total,
          limit,
          format,
          self > 0 && self !== total ? format(self) : null,
        ),
      );
    }

    const peaks = columns.heapPeak;
    const heapPeak = peaks ? ids.reduce((max, id) => Math.max(max, peaks[id]!), 0) : 0;
    if (heapPeak) {
      this._row(
        rows,
        HEAP_PEAK.label,
        usage(heapPeak, HEAP_PEAK.pick(apexLog), HEAP_PEAK.limit(limits), formatBytes, null),
      );
    }
  }

  private _language(): CodeLanguage {
    return this.type === 'soql' ? 'soql' : this.type === 'sosl' ? 'sosl' : 'plain';
  }

  private _ms(ns: number): string {
    return `${formatNsAsMs(ns, MS_PRECISION)} ms`;
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
      const why = describeLevelGap(this.logStore?.levelGap('queryPlans'));
      return html`<span class="value" title=${ifDefined(why || undefined)}>Unknown</span>`;
    }
    const cost = qualifier(`cost ${relativeCost}`);
    return relativeCost <= 1
      ? html`<span class="pill pill--yes">Selective</span>${cost}`
      : html`<span class="pill pill--no">Not selective</span>${cost}`;
  }
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

/** The values of `column` at `ids`. */
function sumOf(ids: readonly number[], column: ArrayLike<number>): number {
  let sum = 0;
  for (const id of ids) {
    sum += column[id]!;
  }
  return sum;
}

/** {@link usageParts} as the row renders it. */
function usage(
  total: number,
  logTotal: number,
  limit: number,
  format: (value: number) => string,
  self: string | null,
): TemplateResult {
  const { primary, qualifiers } = usageParts(total, logTotal, limit, format, self);
  return html`${primary}${qualifier(...qualifiers)}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'event-vitals': EventVitals;
  }
}
