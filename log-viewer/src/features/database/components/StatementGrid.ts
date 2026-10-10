/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-option.js';
import '../../../components/ContextMenu.js';
import '../../../components/datagrid-facet-filter.js';
import '../../../components/datagrid-filter-bar.js';
import '../../../components/datagrid-range-filter.js';
import '../../../components/OverflowList.js';
import '../../../components/VsSelect.js';
import '../../../components/grid/AppGrid.js';
import { css, html, LitElement, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import {
  ColumnSettingsController,
  heldColumnTarget,
  type ColumnTarget,
} from '../../../components/ColumnSettingsController.js';
import type { ContextMenu } from '../../../components/ContextMenu.js';
import { ContextMenuBuilder } from '../../../components/ContextMenuBuilder.js';
import type { AppGrid } from '../../../components/grid/AppGrid.js';
import { bar, msText } from '../../../components/grid/cells.js';
import { exportCsv } from '../../../components/grid/exportCsv.js';
import { GridColumnMenuController } from '../../../components/GridColumnMenuController.js';
import { columnViewSelect, gridToolbarActions } from '../../../components/gridToolbar.js';
import type { StatementType } from '../../../core/events/EventBus.js';
import { formatNsAsMs, nsToMs } from '../../../core/utility/Duration.js';
import {
  Group,
  sum,
  type GridColumn,
  type GridContextDetail,
  type GridRowDetail,
  type GridSelectDetail,
  type GroupBy,
  type RowFilter,
  type TreeSource,
} from '../../../grid/index.js';
import type { ColumnView } from '../../../tabulator/ColumnViews.js';
import { DB_ROW_COUNT_WIDTH, DB_TIME_WIDTH } from '../../../tabulator/ColumnWidths.js';
import { inCountRange, inMsRange, type FilterRange } from '../../../tabulator/filters/MinMax.js';
import { globalStyles } from '../../../styles/global.styles.js';
import { goToRow } from '../../call-tree/navigation.js';
import { formatSOQL, formatSOQLToText } from '../../soql/format/formatter.js';
import { soqlGroupCell } from '../../soql/format/groupHeader.js';

/** What every statement row carries, whatever its type. Its key is its `eventIndex`. */
export interface StatementRow {
  eventIndex: number;
  namespace: string;
  callerNamespace: string;
  rowCount: number;
  timeTaken: number;
}

interface StatementFacet<R> {
  label: string;
  value: (row: R) => string | null | undefined;
}

// `value` null shows the rows ungrouped.
interface StatementGroup<R> {
  label: string;
  value: GroupBy<R> | null;
}

// Its statement column's id is `type`.
interface StatementGridSpec<R> {
  type: StatementType;
  views: ColumnView[];
  placeholder: string;
  facets: StatementFacet<R>[];
  // The first is the grouping on show.
  groups: StatementGroup<R>[];
  columns: (rows: readonly R[]) => GridColumn<R>[];
}

/** A row's report of its pick, which `database-view` turns into the tab's selection. */
export type GridSelectionEvent = CustomEvent<{ type: StatementType; eventIndex: number | null }>;

/** A row's report of the pointer, which marks the statement without picking it. */
export type GridLocateEvent = CustomEvent<{ eventIndexes: readonly number[] }>;

const ROW_MENU_ITEMS = new ContextMenuBuilder()
  .addGroup([{ id: 'show-in-call-tree', label: 'Show in Call Tree' }])
  .build();

/**
 * One statement type's grid in the Database tab: its toolbar filters, grouping,
 * column views, copy and CSV, with the pick and the pointer reported upward as
 * `grid-selection` and `grid-locate`, and a reshape as `grid-reshape`.
 */
export abstract class StatementGrid<R extends StatementRow, L> extends LitElement {
  /** The log lines to show; supplied by `database-view`. */
  @property({ attribute: false })
  lines: L[] = [];

  @state()
  private _source: TreeSource<R> | null = null;
  @state()
  private _columns: GridColumn<R>[] = [];
  @state()
  private _facetValues: string[][] = [];
  @state()
  private _filters: RowFilter<R>[] = [];
  @state()
  private _groupBy: GroupBy<R> | null;
  @state()
  private _marked: ReadonlySet<number> = new Set();

  protected readonly spec: StatementGridSpec<R>;
  // The grid keeps its work per filter object, so a filter keeps its object until its input changes.
  private readonly _filterSlots = new Map<string, RowFilter<R>>();
  private _eventIndexes: ReadonlySet<number> = new Set();
  private _menuEventIndex: number | null = null;
  private _grid: AppGrid<R> | null = null;
  private readonly _columnTarget: ColumnTarget;
  private readonly _settings: ColumnSettingsController;
  private readonly _menus: GridColumnMenuController;

  constructor(spec: StatementGridSpec<R>) {
    super();
    this.spec = spec;
    this._groupBy = spec.groups[0]?.value ?? null;
    // A render binds `_columns` to the grid again, so the column view writes there, not to the grid.
    this._columnTarget = heldColumnTarget<R>(
      () => this._columns,
      (columns) => (this._columns = columns),
    );
    this._settings = new ColumnSettingsController(this, {
      section: `database.${spec.type}`,
      read: (settings) => settings.database?.[spec.type],
      views: spec.views,
      alwaysVisible: [spec.type],
      tables: () => [this._columnTarget],
    });
    this._menus = new GridColumnMenuController({
      table: () => this._columnTarget,
      menu: () => this.renderRoot.querySelector<ContextMenu>('context-menu'),
      columns: this._settings,
    });
  }

  /** Maps the log lines to rows, in log order. */
  protected abstract toRows(lines: readonly L[]): R[];

  /** The grid, once rendered. */
  get grid(): AppGrid<R> | null {
    return this._grid;
  }

  /** Drops this grid's selection, reported upward like any other change. */
  deselectRows(): void {
    this.grid?.deselect();
  }

  /** Whether this grid holds the statement, filtered out or not. */
  owns(eventIndex: number): boolean {
    return this._eventIndexes.has(eventIndex);
  }

  /** Selects the statement's row, scrolling only when it is out of view. False when no row shows it. */
  async selectByEventIndex(eventIndex: number): Promise<boolean> {
    return (await this.grid?.goTo([eventIndex], { scrollIfVisible: false })) ?? false;
  }

  /**
   * Marks the rows for the statements under the inspector's pointer, or drops the
   * mark with an empty list. Not a pick: nothing scrolls and nothing is selected.
   */
  markLocated(eventIndexes: readonly number[]): void {
    // Each grid is offered every mark, and a new set repaints its rows.
    const owned = eventIndexes.filter((eventIndex) => this._eventIndexes.has(eventIndex));
    if (owned.length !== this._marked.size || owned.some((i) => !this._marked.has(i))) {
      this._marked = new Set(owned);
    }
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
      }

      lv-app-grid {
        --grid-max-height: 70vh;

        margin-block-end: var(--lana-space-md);
      }
    `,
  ];

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has('lines')) {
      const rows = this.toRows(this.lines);
      this._eventIndexes = new Set(rows.map((row) => row.eventIndex));
      this._source = { roots: rows, key: (row) => row.eventIndex };
      this._columns = this.spec.columns(rows);
      this._settings.applyTo(this._columnTarget);
      this._facetValues = this.spec.facets.map((facet) =>
        [...new Set(rows.map(facet.value).filter((v): v is string => !!v))].sort(),
      );
    }
  }

  private readonly _gridMounted = (el?: Element): void => {
    this._grid = (el as AppGrid<R> | undefined) ?? null;
    if (this._grid) {
      this._menus.initGrid(this._grid);
    }
  };

  render(): TemplateResult {
    const { spec } = this;
    return html`
      <datagrid-filter-bar>
        <overflow-list slot="filters" menu-heading="Filters" icon="filter">
          ${spec.facets.map(
            (facet, i) =>
              html`<datagrid-facet-filter
                label="${facet.label}"
                .values="${this._facetValues[i] ?? []}"
                @datagrid-facet-change="${(e: CustomEvent<{ selected: string[] }>) =>
                  this._facetChanged(facet, e.detail.selected)}"
              ></datagrid-facet-filter>`,
          )}
          <datagrid-range-filter
            label="Row Count"
            @datagrid-range-change="${(e: CustomEvent<{ range: FilterRange }>) =>
              this._setFilter('rowCount', e.detail.range, (range, row) =>
                inCountRange(range, row.rowCount),
              )}"
          ></datagrid-range-filter>
          <datagrid-range-filter
            label="Time Taken"
            unit="ms"
            @datagrid-range-change="${(e: CustomEvent<{ range: FilterRange }>) =>
              this._setFilter('timeTaken', e.detail.range, (range, row) =>
                inMsRange(range, row.timeTaken),
              )}"
          ></datagrid-range-filter>
        </overflow-list>

        ${columnViewSelect({
          id: `${spec.type}-column-view`,
          views: spec.views,
          columns: this._settings,
          menus: this._menus,
        })}

        <vs-select
          dense
          slot="group"
          id="${spec.type}-groupby-dropdown"
          prefix="Group"
          label="Group by"
          @change="${this._groupChanged}"
        >
          ${spec.groups.map((group) => html`<vscode-option>${group.label}</vscode-option>`)}
        </vs-select>

        ${gridToolbarActions({
          menus: this._menus,
          exportToCSV: () => void this._exportCsv(),
          copyToClipboard: () => void this.grid?.copy(),
        })}
      </datagrid-filter-bar>

      <lv-app-grid
        ${ref(this._gridMounted)}
        fit-rows
        footer-position="rows"
        .placeholder="${spec.placeholder}"
        .source="${this._source}"
        .columns="${this._columns}"
        .filters="${this._filters}"
        .groupBy="${this._groupBy}"
        .marked="${this._marked}"
        @lv-grid-select="${this._onSelect}"
        @lv-grid-locate="${this._onLocate}"
        @lv-grid-context="${this._onContext}"
        @lv-grid-reshape="${this._onReshape}"
      ></lv-app-grid>
      <context-menu @menu-select="${this._onMenuSelect}"></context-menu>
    `;
  }

  private _facetChanged(facet: StatementFacet<R>, selected: string[]): void {
    const picked = new Set(selected);
    this._replaceFilter(
      `facet:${facet.label}`,
      selected.length ? { test: (row) => picked.has(facet.value(row) ?? '') } : null,
    );
  }

  private _setFilter(
    name: string,
    range: FilterRange,
    keeps: (range: FilterRange, row: R) => boolean,
  ): void {
    const open = range.start === null && range.end === null;
    this._replaceFilter(name, open ? null : { test: (row) => keeps(range, row) });
  }

  private _replaceFilter(name: string, filter: RowFilter<R> | null): void {
    if (filter) {
      this._filterSlots.set(name, filter);
    } else {
      this._filterSlots.delete(name);
    }
    this._filters = [...this._filterSlots.values()];
  }

  private _groupChanged(event: Event): void {
    const label = (event.target as HTMLInputElement).value;
    this._groupBy = this.spec.groups.find((group) => group.label === label)?.value ?? null;
  }

  private async _exportCsv(): Promise<void> {
    if (this.grid) {
      await exportCsv(this.grid, `${this.spec.type}.csv`);
    }
  }

  private readonly _onSelect = (e: CustomEvent<GridSelectDetail<R>>): void => {
    // A group row is no statement, so it changes nothing upstream.
    if (e.detail.target instanceof Group) {
      return;
    }
    this._emit<GridSelectionEvent['detail']>('grid-selection', {
      type: this.spec.type,
      eventIndex: e.detail.row?.eventIndex ?? null,
    });
  };

  private readonly _onLocate = (e: CustomEvent<GridRowDetail<R>>): void => {
    const { row } = e.detail;
    this._emit<GridLocateEvent['detail']>('grid-locate', {
      eventIndexes: row ? [row.eventIndex] : [],
    });
  };

  private readonly _onContext = (e: CustomEvent<GridContextDetail<R>>): void => {
    const { row, event } = e.detail;
    const menu = this.renderRoot.querySelector<ContextMenu>('context-menu');
    if (!row || !menu || window.getSelection()?.type === 'Range') {
      return;
    }
    event.preventDefault();
    void this.selectByEventIndex(row.eventIndex);
    this._menuEventIndex = row.eventIndex;
    menu.show(ROW_MENU_ITEMS, event.clientX, event.clientY);
  };

  private readonly _onReshape = (): void => {
    this._emit('grid-reshape', null);
  };

  private readonly _onMenuSelect = (e: CustomEvent<{ itemId: string }>): void => {
    const { itemId } = e.detail;
    if (itemId === 'show-in-call-tree') {
      if (this._menuEventIndex !== null) {
        void goToRow({ eventIndex: this._menuEventIndex });
      }
      return;
    }
    this._menus.select(itemId);
  };

  // Bubbles to `database-view`'s shadow root, and stops there.
  private _emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true }));
  }
}

/** `n/total` on hover, as the row count's share of the grid's own total. */
export function rowCountColumn<R extends StatementRow>(rows: readonly R[]): GridColumn<R> {
  const total = rows.reduce((all, row) => all + row.rowCount, 0);
  const cell = (value: number) => bar(value, total, { precision: 0, percent: false });
  return {
    id: 'rowCount',
    title: 'Row Count',
    width: DB_ROW_COUNT_WIDTH,
    align: 'end',
    cell: (row) => cell(row.rowCount),
    text: (row) => String(row.rowCount),
    tooltip: (row) => `${row.rowCount}${total > 0 ? `/${total}` : ''}`,
    sort: { value: (row) => row.rowCount },
    sortFirst: 'desc',
    calc: sum((row) => row.rowCount),
    total: cell,
  };
}

/** The time a statement took, in milliseconds, with a bar for its share of the grid's own total. */
export function timeTakenColumn<R extends StatementRow>(rows: readonly R[]): GridColumn<R> {
  const totalMs = nsToMs(rows.reduce((all, row) => all + row.timeTaken, 0));
  const cell = (ns: number) => bar(nsToMs(ns), totalMs, { percent: false });
  return {
    id: 'timeTaken',
    title: 'Time Taken (ms)',
    width: DB_TIME_WIDTH,
    align: 'end',
    cell: (row) => cell(row.timeTaken),
    text: (row) => msText(row.timeTaken),
    exportText: (row) => formatNsAsMs(row.timeTaken, 3),
    sort: { value: (row) => row.timeTaken },
    sortFirst: 'desc',
    calc: sum((row) => row.timeTaken),
    total: cell,
  };
}

/**
 * The statement column: the query shown inline and highlighted for SOQL and SOSL,
 * plain for DML. Find searches what it shows; copy and CSV write the raw text.
 */
export function statementColumn<R extends object>(opts: {
  id: string;
  title: string;
  value: (row: R) => string;
  dialect: 'soql' | 'sosl' | null;
  sortFirst?: 'asc' | 'desc';
}): GridColumn<R> {
  const { dialect, value } = opts;
  const format = { mode: 'inline', dialect: dialect ?? 'soql' } as const;
  // Keyed by query, not row: a log repeats a few queries many times, and find, copy and paint all format.
  const inlineHtml = new Map<string, string>();
  const inlineText = new Map<string, string>();
  // One per key: a filter changes the counts, and the old cell is not wanted again.
  const groupCells = new Map<string, { count: number; cell: ReturnType<typeof soqlGroupCell> }>();
  return {
    id: opts.id,
    title: opts.title,
    minWidth: 140,
    cell: (row) =>
      dialect
        ? html`<span class="soql-block soql-inline"
            >${unsafeHTML(cached(inlineHtml, value(row), (query) => formatSOQL(query, format)))}</span
          >`
        : value(row),
    text: (row) =>
      dialect
        ? cached(inlineText, value(row), (query) => formatSOQLToText(query, format))
        : value(row),
    exportText: value,
    tooltip: value,
    sort: { value },
    sortFirst: opts.sortFirst ?? 'desc',
    footer: 'Total',
    groupCell: (group) => {
      let held = groupCells.get(group.key);
      if (held?.count !== group.rows.length) {
        held = { count: group.rows.length, cell: soqlGroupCell(group) };
        groupCells.set(group.key, held);
      }
      return held.cell;
    },
  };
}

function cached<T>(cache: Map<string, T>, key: string, make: (key: string) => T): T {
  let value = cache.get(key);
  if (value === undefined) {
    value = make(key);
    cache.set(key, value);
  }
  return value;
}
