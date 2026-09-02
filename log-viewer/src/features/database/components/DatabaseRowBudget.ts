/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { consume } from '@lit/context';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { CategoryPaletteController } from '../../../components/categoryTime.js';
import {
  ESTIMATED_LIMITS_TEXT,
  NO_CUMULATIVE_LIMITS_TEXT,
} from '../../../components/logOverviewMetrics.js';
import '../../../components/StackedTimeBar.js';
import { segmentsWithTail, type StackedSegment } from '../../../components/StackedTimeBar.js';
import { logContext } from '../../../core/log/logContext.js';
import type { LogStore } from '../../../core/log/LogStore.js';
import { formatInteger } from '../../../core/utility/Util.js';
import { globalStyles } from '../../../styles/global.styles.js';
import { inspectorSectionStyles } from '../../../styles/inspectorSection.styles.js';
import { NO_STATEMENTS } from '../services/databaseOverview.js';
import {
  rowBudgets,
  type ObjectRows,
  type RowBudget,
  type RowBudgetKind,
  type RowCount,
  type RowGroup,
} from '../services/rowBudget.js';
import { kindColors } from './DatabaseOverview.js';
import { governorTier } from './GovernorSummary.js';

/** More than a namespace bar: shades in a wide card, not a dock legend. */
const MAX_OBJECTS = 8;

const OBJECTS_LABEL = 'Query and DML rows by SObject';

const KIND_LABEL: Record<RowBudgetKind, string> = { SOQL: 'Query rows', DML: 'DML rows' };

/**
 * The rows a log holds against the two row limits, split by the SObject that
 * holds them: the bar is the limit, the segments are the objects, and the space
 * left is the headroom — which neither the grids nor the gauges say.
 *
 * A search holds no transaction row total, only a per-query cap, so it reads as
 * the worst single search and never as a bar.
 */
@customElement('database-rows')
export class DatabaseRowBudget extends LitElement {
  private readonly _palette = new CategoryPaletteController(this);

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  static styles = [
    globalStyles,
    inspectorSectionStyles,
    css`
      .note {
        padding: var(--lana-space-2xs) 0 0;
        font-size: var(--lana-text-sm);
      }

      .budget + .budget {
        padding-top: var(--lana-space-sm);
      }

      .budget__head,
      .objects__head {
        padding-bottom: var(--lana-space-2xs);
        font-size: var(--lana-text-sm);
      }

      .budget__head {
        display: flex;
        align-items: baseline;
        gap: var(--lana-space-sm);
      }

      .budget__figure {
        margin-left: auto;
        white-space: nowrap;
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
      }

      .budget__figure--safe {
        color: var(--lana-fg);
      }
      .budget__figure--warn {
        color: var(--lana-severity-warning);
      }
      .budget__figure--danger {
        color: var(--lana-severity-error);
      }

      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--lana-space-3xs) var(--lana-space-lg);
        padding-top: var(--lana-space-sm);
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }

      .counts__value {
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  render() {
    const log = this.logStore?.log;
    const budgets = log ? rowBudgets(log) : null;
    if (!budgets?.statements) {
      return html`<p class="note">${NO_STATEMENTS}</p>`;
    }
    const colors = kindColors(this._palette);
    const shown = budgets.budgets.filter((budget) => (budget.used ?? budget.observed) > 0);
    return html`
      ${shown.map((budget) => this._budget(budget, colors[budget.kind]))}
      ${budgets.objects.length > 0 ? this._objects(budgets.objects, colors) : ''}
      ${
        shown.some(overLimit)
          ? html`<p class="note">
              Past the row limit, marked on the bar. A certified package holds its own limits, so a
              log of several namespaces can pass one.
            </p>`
          : ''
      }
      <p class="counts"> ${budgets.counts.map((count) => this._count(count))} </p>
      ${
        budgets.worstSearch
          ? html`<p class="note">
              Worst search ${formatInteger(budgets.worstSearch.rows)} of
              ${formatInteger(budgets.worstSearch.limit)} rows per query.
            </p>`
          : ''
      }
      ${budgets.hasLimits ? '' : html`<p class="note">${caveat(budgets.budgets)}</p>`}
    `;
  }

  /**
   * Every SObject once, read beside written. The two limits are separate bars, so
   * an object on both sides is only whole here, and its hue says which way it leans.
   */
  private _objects(
    objects: readonly ObjectRows[],
    colors: Record<RowBudgetKind, string>,
  ): TemplateResult {
    const segments = segmentsWithTail(
      objects,
      (object, index) => ({
        label: object.sObject,
        value: object.rows,
        color: shade(colors[object.rowsWritten > object.rowsRead ? 'DML' : 'SOQL'], index),
        detail: `${formatInteger(object.rowsRead)} read · ${formatInteger(object.rowsWritten)} written`,
      }),
      MAX_OBJECTS,
    );
    return html`
      <div class="budget">
        <p class="objects__head">${OBJECTS_LABEL}</p>
        <stacked-time-bar
          .format=${formatInteger}
          label=${OBJECTS_LABEL}
          legend
          .segments=${segments}
        ></stacked-time-bar>
      </div>
    `;
  }

  /** One statement count, against its limit where the log names one. */
  private _count(count: RowCount): TemplateResult {
    const limit = count.limit > 0 ? `/${formatInteger(count.limit)}` : '';
    return html`<span
      >${count.label} <span class="counts__value">${formatInteger(count.used)}${limit}</span></span
    >`;
  }

  /** One limit: the figure, the objects that hold it, and what is unaccounted for. */
  private _budget(budget: RowBudget, hue: string): TemplateResult {
    const shown = budget.used ?? budget.observed;
    const percent = budget.limit > 0 ? (shown / budget.limit) * 100 : 0;
    const against = budget.limit > 0 ? ` / ${formatInteger(budget.limit)}` : '';
    const segments = objectSegments(budget.groups, hue);
    // What the governor counted and no statement holds. Never negative: the
    // statements can sum past a peak the log took mid-transaction.
    const unattributed = Math.max(0, shown - budget.observed);
    if (unattributed > 0) {
      segments.push({
        label: 'Not accounted for',
        value: unattributed,
        // Fainter than the tail's muted grey, which can sit right beside it.
        color: 'color-mix(in srgb, var(--lana-fg-muted) 50%, transparent)',
      });
    }

    return html`
      <div class="budget">
        <p class="budget__head">
          <span>${KIND_LABEL[budget.kind]}</span>
          <span class="budget__figure budget__figure--${governorTier(percent)}"
            >${formatInteger(shown)}${against}</span
          >
        </p>
        <stacked-time-bar
          .format=${formatInteger}
          label=${KIND_LABEL[budget.kind]}
          legend
          .segments=${segments}
          .total=${budget.limit}
        ></stacked-time-bar>
      </div>
    `;
  }
}

/** Whether the segments passed the limit, which is when the bar marks it. */
function overLimit(budget: RowBudget): boolean {
  return budget.limit > 0 && Math.max(budget.observed, budget.used ?? 0) > budget.limit;
}

/** Why the figures are what the log itself showed. */
function caveat(budgets: readonly RowBudget[]): string {
  return budgets.some((budget) => budget.observed > 0)
    ? ESTIMATED_LIMITS_TEXT
    : NO_CUMULATIVE_LIMITS_TEXT;
}

/** The objects as segments of one hue, stepped for identity only. */
function objectSegments(groups: readonly RowGroup[], hue: string): StackedSegment[] {
  return segmentsWithTail(
    groups,
    (group, index) => ({
      label: group.sObject,
      value: group.rows,
      color: shade(hue, index),
      detail: `${formatInteger(group.statements)} statement${group.statements === 1 ? '' : 's'}`,
    }),
    MAX_OBJECTS,
  );
}

function shade(hue: string, index: number): string {
  const strength = Math.max(100 - index * 9, 40);
  return strength === 100 ? hue : `color-mix(in srgb, ${hue} ${strength}%, transparent)`;
}

declare global {
  interface HTMLElementTagNameMap {
    'database-rows': DatabaseRowBudget;
  }
}
