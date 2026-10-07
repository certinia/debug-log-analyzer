/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, nothing, render, type TemplateResult } from 'lit';

import { Group, type RowKey, type RowView } from '../core/index.js';
import type { RowPainter } from '../render/index.js';
import type { CellContent, GridColumn } from './column.js';

/** What a row's look depends on beyond its data. Read on each paint. */
export interface PaintState<R> {
  columns: readonly GridColumn<R>[];
  isSelected(target: RowKey | Group<R>): boolean;
  marked: ReadonlySet<RowKey>;
  rowClass: ((row: R) => string | undefined) | null;
}

const total = <R>(column: GridColumn<R>, value: number | undefined): CellContent =>
  value === undefined ? '' : (column.total?.(value) ?? String(value));

function cellClass<R>(column: GridColumn<R>, first: boolean): string {
  return [
    'cell',
    first ? 'tree' : '',
    column.align === 'end' ? 'end' : '',
    column.className ?? '',
  ].join(' ');
}

/** The expand control. A button would take a tab stop per row; the grid owns the keys. */
const twisty = (expandable: boolean, expanded: boolean): TemplateResult =>
  html`<span
    class="twisty ${expandable ? (expanded ? 'open' : 'closed') : ''}"
    data-toggle
  ></span>`;

function groupCells<R>(group: Group<R>, columns: readonly GridColumn<R>[], open: boolean) {
  return columns.map(
    (column, i) =>
      html`<div class=${cellClass(column, i === 0)} role="gridcell">
        ${
          i === 0
            ? html`${twisty(true, open)}<span class="content"
                  >${column.groupCell?.(group) ?? `${group.key} (${group.rows.length})`}</span
                >`
            : column.calc
              ? total(column, group.totals[column.id])
              : nothing
        }
      </div>`,
  );
}

// `data-grid-find` is render's FIND_ATTR: template attribute names have to be literal.
function rowCells<R>(
  row: R,
  columns: readonly GridColumn<R>[],
  depth: number,
  kids: boolean,
  open: boolean,
) {
  return columns.map(
    (column, i) =>
      html`<div
        class=${cellClass(column, i === 0)}
        role="gridcell"
        title=${column.tooltip?.(row) ?? nothing}
        ?data-grid-find=${column.text !== undefined}
        style=${i === 0 ? `--grid-depth: ${depth}` : nothing}
      >
        ${
          i === 0
            ? html`${twisty(kids, open)}<span class="content">${column.cell(row)}</span>`
            : column.cell(row)
        }
      </div>`,
  );
}

/** Paints rows with lit-html: a reused row element keeps its template and updates only its values. */
export function litPainter<R extends object>(state: () => PaintState<R>): RowPainter<R> {
  return {
    paint(el: HTMLElement, index: number, rows: RowView<R>): void {
      const { columns, isSelected, marked, rowClass } = state();
      const entry = rows.rowAt(index);
      const open = rows.isExpandedAt(index);
      const shown = columns.filter((column) => !column.hidden);
      if (entry instanceof Group) {
        el.className = 'row group';
        el.ariaSelected = String(isSelected(entry));
        render(groupCells(entry, shown, open), el);
        return;
      }
      const key = rows.keyAt(index);
      const extra = rowClass?.(entry);
      el.className = `row${marked.has(key) ? ' marked' : ''}${extra ? ` ${extra}` : ''}`;
      el.ariaSelected = String(isSelected(key));
      render(rowCells(entry, shown, rows.depthAt(index), rows.hasChildrenAt(index), open), el);
    },
  };
}
