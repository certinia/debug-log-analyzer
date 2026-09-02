/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html, unsafeCSS, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { CategoryPaletteController } from '../../../components/categoryTime.js';
import {
  dispatchInspectorLocate,
  dispatchInspectorReveal,
} from '../../../components/inspectorReveal.js';
import { logNamespacePalette } from '../../../components/namespacePalette.js';
import '../../../components/StackedTimeBar.js';
import { segmentsWithTail } from '../../../components/StackedTimeBar.js';
import { logContext } from '../../../core/log/logContext.js';
import type { LogStore } from '../../../core/log/LogStore.js';
import { formatDuration, formatInteger, sharePercent } from '../../../core/utility/Util.js';
import { globalStyles } from '../../../styles/global.styles.js';
import { inspectorSectionStyles } from '../../../styles/inspectorSection.styles.js';
import { revealRowStyles } from '../../../styles/revealRow.styles.js';
import type { SoqlBudget } from '../../soql/format/budget.js';
import { formatSOQLToTemplate } from '../../soql/format/formatter.js';
import { soqlSyntaxStyles } from '../../soql/styles/soql-syntax.css.js';
import {
  concentration,
  databaseOverview,
  type DatabaseBreakdown,
  type DatabaseStatement,
  NO_STATEMENTS,
  type StatementKind,
} from '../services/databaseOverview.js';

/**
 * How many rows a ranked section shows before it defers to the grids beside it.
 * These sections are a springboard: the sortable, complete view is the tab.
 */
const MAX_ROWS = 5;

/**
 * The room a statement label has. Lines are clauses, not display lines: the row
 * is one line whatever this holds, so the budget buys elisions — `+8 fields`,
 * `… +2 conditions` — over a raw query cut off mid-word.
 */
const LABEL_BUDGET: SoqlBudget = { lines: 3, columns: 40 };

/** The rows a ranked section shows, and the ones it leaves to the grids. */
function topRows<T>(rows: readonly T[]): { shown: readonly T[]; rest: readonly T[] } {
  return { shown: rows.slice(0, MAX_ROWS), rest: rows.slice(MAX_ROWS) };
}

/**
 * A share. One decimal below 100 and none at exactly 100, so 99.9% is never
 * rounded into a claim that something holds everything.
 */
function shareText(percent: number): string {
  return percent >= 100 ? '100%' : `${percent.toFixed(1)}%`;
}

/**
 * The three kinds in the flame chart's own colours. The parser categorises a
 * search as SOQL, so SOSL has no hue of its own: it shows as a tint of the query
 * hue, which keeps these graphics truthful against the chart.
 */
export function kindColors(palette: CategoryPaletteController): Record<StatementKind, string> {
  const soql = palette.colorFor('SOQL');
  return {
    SOQL: soql,
    DML: palette.colorFor('DML'),
    SOSL: `color-mix(in srgb, ${soql} 55%, transparent)`,
  };
}

const sectionStyles = [
  globalStyles,
  inspectorSectionStyles,
  css`
    .note {
      padding: var(--lana-space-2xs) 0 0;
    }
  `,
];

/**
 * Which statements own the database time. The grids sort by duration, but not by
 * what makes a statement worth fixing: this ranks by self time, so a query
 * inside a DML trigger is credited to itself and not to the DML, sums every time
 * the log ran the same statement into one row, and gives each row the figures no
 * grid holds — its cost per row it touched, how many times it ran, and how much
 * of its duration is really the statements inside it.
 *
 * The meter is the statement's whole share of database time, solid up to its own
 * self share, so a DML that is really a nested query reads as one at a glance.
 */
@customElement('database-concentration')
export class DatabaseConcentration extends LitElement {
  private readonly _palette = new CategoryPaletteController(this);

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  static styles = [
    ...sectionStyles,
    revealRowStyles,
    unsafeCSS(soqlSyntaxStyles),
    css`
      /* The sub line sheds parts by the dock's width, not the window's. */
      :host {
        container-type: inline-size;
      }

      /* Shed from the least telling: the database's share of the descendant time,
         then the repeat count, then the cost per row. The share and the
         self-against-descendants split are the row's point, so they always stay. */
      @container (max-width: 22rem) {
        .sub__database {
          display: none;
        }
      }

      @container (max-width: 19rem) {
        .sub__repeats {
          display: none;
        }
      }

      @container (max-width: 16rem) {
        .sub__rows {
          display: none;
        }
      }

      .headline {
        padding-bottom: var(--lana-space-xs);
        font-size: var(--lana-text-sm);
      }

      .headline__figure {
        color: var(--lana-fg);
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
      }

      /* The tail: what every statement past the rows above holds, together. */
      .tail {
        display: flex;
        gap: var(--lana-space-sm);
        padding-top: var(--lana-space-2xs);
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }

      .tail__value {
        margin-left: auto;
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  render() {
    const log = this.logStore?.log;
    const overview = log ? databaseOverview(log) : null;
    if (!overview?.ranked.length) {
      return html`<p class="note">${NO_STATEMENTS}</p>`;
    }
    const { count, percent } = concentration(overview);
    const { shown, rest } = topRows(overview.ranked);
    const colors = kindColors(this._palette);
    const databaseNs = overview.time.timeNs;
    const shownNs = shown.reduce((running, statement) => running + statement.netNs, 0);

    return html`
      <p class="headline">
        <span class="headline__figure">${formatInteger(count)}</span>
        ${count === 1 ? 'statement holds' : 'statements hold'}
        <span class="headline__figure">${shareText(percent)}</span>
        of DB time ·
        <span class="headline__figure">${shareText(overview.time.percentOfLog)}</span>
        of log
      </p>
      ${shown.map((statement) => this._row(statement, databaseNs, colors))}
      ${
        rest.length > 0
          ? html`<p class="tail">
              <span
                >${
                  rest.length === 1
                    ? 'the other statement'
                    : `the other ${formatInteger(rest.length)} statements`
                }</span
              >
              <span class="tail__value"
                >${shareText(sharePercent(databaseNs - shownNs, databaseNs))}</span
              >
            </p>`
          : ''
      }
    `;
  }

  private _row(
    statement: DatabaseStatement,
    databaseNs: number,
    colors: Record<StatementKind, string>,
  ) {
    const own = sharePercent(statement.netNs, databaseNs);
    return html`
      <button
        class="bleed-row reveal-row"
        type="button"
        title=${rowTitle(statement)}
        style=${styleMap({
          '--row-hue': colors[statement.kind],
          // Solid to the statement's self time, faded on to its total: the gap is
          // its descendants.
          '--self-pct': `${sharePercent(statement.selfNs, statement.timeNs).toFixed(1)}%`,
        })}
        @click=${() => dispatchInspectorReveal(this, statement.eventIndex)}
        @pointerenter=${() => dispatchInspectorLocate(this, statement.eventIndexes)}
        @pointerleave=${() => dispatchInspectorLocate(this, [])}
      >
        <span class="reveal-row__sr">${statement.kind}</span>
        <span class="reveal-row__name" title=${statement.label}>${statementLabel(statement)}</span>
        <span class="reveal-row__value reveal-row__value--primary"
          >${formatDuration(statement.timeNs)}</span
        >
        <span class="reveal-row__sub">${subLine(statement, own)}</span>
        <span class="reveal-row__meter"
          ><span
            class="reveal-row__meter-fill"
            style=${styleMap({ width: `${sharePercent(statement.timeNs, databaseNs)}%` })}
          ></span
        ></span>
      </button>
    `;
  }
}

/**
 * Database time split across namespaces, as one bar per question. Whose code
 * holds the time — yours or a package's — is
 * the thing to dig into; the grids hold one statement kind each, so none of them
 * can be read across the three.
 *
 * Two bars, because a DML and the time it takes belong to different people. The
 * first charges every statement to the namespace that issued it. The second
 * charges whatever ran beneath it to its own namespace. A package whose trigger
 * fires on your DML shows up only in the second, which is the finding. They are
 * the same bar when nothing runs inside the statements, so the second is shown
 * only when it says something new.
 *
 * Each namespace keeps one colour across both bars, and hovering one names its
 * three kinds, so a namespace worth digging into says which grid to open.
 */
@customElement('database-namespaces')
export class DatabaseNamespaces extends LitElement {
  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  static styles = [
    ...sectionStyles,
    css`
      .bar + .bar {
        padding-top: var(--lana-space-sm);
      }

      .bar__title {
        padding-bottom: var(--lana-space-2xs);
        font-size: var(--lana-text-sm);
      }
    `,
  ];

  render() {
    const log = this.logStore?.log;
    const overview = log ? databaseOverview(log) : null;
    if (!overview?.askedBy.length || !log) {
      return html`<p class="note">${NO_STATEMENTS}</p>`;
    }
    // The log's own palette, so a namespace that moves between the two bars is
    // followed by eye and reads the same on the Timeline's bar.
    const color = logNamespacePalette(log);
    const asked = this._bar('Called from namespace', overview.askedBy, color);
    // Identical bars would read as a finding where there is none.
    if (sameSplit(overview.askedBy, overview.burnedIn)) {
      return asked;
    }
    return html`${asked} ${this._bar('Ran in namespace', overview.burnedIn, color)}`;
  }

  private _bar(
    title: string,
    namespaces: DatabaseBreakdown[],
    color: (namespace: string) => string,
  ) {
    const segments = segmentsWithTail(namespaces, (row) => ({
      label: row.key,
      value: row.timeNs,
      color: color(row.key),
      detail: kindSplit(row),
    }));

    return html`
      <div class="bar">
        <p class="bar__title">${title}</p>
        <stacked-time-bar legend label=${title} .segments=${segments}></stacked-time-bar>
      </div>
    `;
  }
}

/** Whether two breakdowns hold the same namespaces for the same time. */
function sameSplit(left: DatabaseBreakdown[], right: DatabaseBreakdown[]): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => row.key === right[index]?.key && row.timeNs === right[index]?.timeNs)
  );
}

/**
 * The statement, highlighted and elided to fit one row. A DML names an operation
 * and an object, so it has nothing to highlight.
 */
function statementLabel(statement: DatabaseStatement): TemplateResult | string {
  if (statement.kind === 'DML') {
    return statement.label;
  }
  return html`<span class="soql-block soql-inline"
    >${formatSOQLToTemplate(statement.label, {
      mode: 'pretty',
      dialect: statement.kind === 'SOSL' ? 'sosl' : 'soql',
      budget: LABEL_BUDGET,
    })}</span
  >`;
}

/**
 * What the row's time is a share of, then the figures a grid row cannot give:
 * how its duration splits into `self` and `desc` — the statement's own time
 * against everything beneath it — what it cost per row it touched, which names a
 * selectivity problem, how often it ran, which names a query in a loop, and how
 * much of `desc` the database itself did.
 *
 * One line always, so the section stays scannable. Each part carries its own
 * separator, so a narrow dock drops whole parts by container width instead of
 * cutting a figure in half; the reveal title keeps the full reading.
 */
function subLine(statement: DatabaseStatement, ownPercent: number): TemplateResult {
  const perRow = statement.rows > 0 ? statement.netNs / statement.rows / 1_000_000 : 0;
  // Self is the total twice over when nothing ran inside the statement.
  const descendantNs = statement.timeNs - statement.selfNs;
  const databaseNs = statement.timeNs - statement.netNs;

  return html`<span>${shareText(ownPercent)}</span>${
      descendantNs > 0
        ? html`<span class="sub__split">
            · ${formatDuration(statement.selfNs)} self · ${formatDuration(descendantNs)} desc</span
          >`
        : ''
    }<span class="sub__rows">
      ·
      ${
        statement.rows > 0
          ? `${perRow.toFixed(perRow < 1 ? 2 : 1)} ms/row`
          : // The cost is real and the rows are not there: say so, rather than
            // divide by a row the log never recorded.
            'no rows'
      }</span
    >${
      statement.repeats > 1
        ? html`<span class="sub__repeats"> · ran ${formatInteger(statement.repeats)}×</span>`
        : ''
    }${
      databaseNs > 0
        ? html`<span class="sub__database"> · ${formatDuration(databaseNs)} db</span>`
        : ''
    }`;
}

/** The whole reading, for a row a narrow dock has shortened. */
function rowTitle(statement: DatabaseStatement): string {
  const databaseNs = statement.timeNs - statement.netNs;
  const parts = ['Show this statement in the grid'];
  if (databaseNs > 0) {
    parts.push(`${formatDuration(databaseNs)} of the descendant time is database time`);
  }
  return parts.join(' · ');
}

/** `SOQL 1.2s · DML 340ms` — the kinds a namespace spent its time in. */
function kindSplit(row: DatabaseBreakdown): string {
  return (
    [
      ['SOQL', row.soqlTimeNs],
      ['DML', row.dmlTimeNs],
      ['SOSL', row.soslTimeNs],
    ] as const
  )
    .filter(([, timeNs]) => timeNs > 0)
    .map(([kind, timeNs]) => `${kind} ${formatDuration(timeNs)}`)
    .join(' · ');
}

declare global {
  interface HTMLElementTagNameMap {
    'database-concentration': DatabaseConcentration;
    'database-namespaces': DatabaseNamespaces;
  }
}
