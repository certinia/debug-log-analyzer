/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Tabulator } from 'tabulator-tables';

import type { ContextMenuItem } from '../components/ContextMenu.js';

/**
 * A preconfigured set of columns tailored to a kind of investigation. Column
 * membership is keyed by Tabulator `field`. Presets list every applicable field
 * name; fields absent from a given table are ignored by {@link applyColumnView},
 * so one preset works across differently-shaped tables (e.g. the three call-tree
 * modes name equivalent columns differently: `duration.total` vs `totalTime`).
 */
export interface ColumnView {
  /** Stable identifier, persisted in settings and shown in the UI. */
  id: string;
  /** The fields visible in this view, or `null` to show every column. */
  fields: string[] | null;
}

// Count/row limit metrics as their Total-variant fields. Self variants
// (`*.self`) exist as hidden columns and are surfaced only by the Memory view
// (heap) or a user override.
const LIMIT_COUNT_TOTALS = ['dmlCount.total', 'soqlCount.total', 'soslCount.total'];
const LIMIT_ROW_TOTALS = ['dmlRowCount.total', 'soqlRowCount.total', 'soslRowCount.total'];

// Both naming variants of the total/self time columns: `totalTime`/`totalSelfTime`
// (aggregated & bottom-up) and `duration.*` (time-order). Listing both lets one
// preset drive all three tables.
export const TIME_TOTALS = ['totalTime', 'totalSelfTime', 'duration.total', 'duration.self'];

/**
 * Column views for the Call Tree and Analysis tables. General is an explicit
 * curated set (not `null`) so the Self columns stay hidden by default. Each view
 * answers one question, so a metric belongs to one view rather than every view:
 * heap detail lives in Memory (peak also in Governor Limits, since heap size is
 * one), governor utilisation (`governorCost`/`governorCostMax`) in Governor
 * Limits. All stay toggleable anywhere via the column menu.
 */
export const CALL_TREE_VIEWS: ColumnView[] = [
  {
    // SOSL is omitted here (near-always-zero for most orgs); it stays in the
    // Governor Limits and Database views.
    id: 'General',
    fields: [
      'namespace',
      'callCount',
      'dmlCount.total',
      'soqlCount.total',
      'thrownCount.total',
      'dmlRowCount.total',
      'soqlRowCount.total',
      ...TIME_TOTALS,
    ],
  },
  {
    id: 'Time',
    fields: ['namespace', 'callCount', 'avgSelfTime', ...TIME_TOTALS],
  },
  {
    id: 'Governor Limits',
    fields: [
      'namespace',
      ...LIMIT_COUNT_TOTALS,
      ...LIMIT_ROW_TOTALS,
      'thrownCount.total',
      'heapPeak',
      'governorCost',
      'governorCostMax',
    ],
  },
  {
    // Timing sits alongside the counts so this view answers "which query-heavy
    // path is slow" — the thing Governor Limits (no timing) can't.
    id: 'Database',
    fields: ['namespace', ...LIMIT_COUNT_TOTALS, ...LIMIT_ROW_TOTALS, ...TIME_TOTALS],
  },
  {
    id: 'Memory',
    fields: [
      'namespace',
      'heapAllocated.total',
      'heapAllocated.self',
      'heapGross.total',
      'heapGross.self',
      'heapPeak',
    ],
  },
];

/** Column views for the SOQL database table. */
export const SOQL_VIEWS: ColumnView[] = [
  {
    // Object is visible by default (its __mdt suffix flags the "does this count
    // toward the SOQL limit?" case of #162). isSelective/aggregations still
    // available via the Performance view and the column menu.
    id: 'General',
    fields: ['objectType', 'namespace', 'rowCount', 'timeTaken'],
  },
  { id: 'Performance', fields: ['isSelective', 'relativeCost', 'rowCount', 'timeTaken'] },
  {
    id: 'Query Plan',
    fields: ['relativeCost', 'leadingOperationType', 'sObjectType', 'cardinality'],
  },
  { id: 'Limits', fields: ['objectType', 'namespace', 'rowCount', 'timeTaken'] },
];

/** Column views for the DML database table. */
export const DML_VIEWS: ColumnView[] = [
  { id: 'General', fields: ['objectType', 'callerNamespace', 'rowCount', 'timeTaken'] },
  { id: 'Timing', fields: ['rowCount', 'timeTaken'] },
  { id: 'Limits', fields: ['objectType', 'callerNamespace', 'rowCount'] },
];

/** Column views for the SOSL database table. */
export const SOSL_VIEWS: ColumnView[] = [
  { id: 'General', fields: ['namespace', 'callerNamespace', 'rowCount', 'timeTaken'] },
  { id: 'Timing', fields: ['rowCount', 'timeTaken'] },
];

export function getColumnView(views: ColumnView[], id: string): ColumnView | undefined {
  return views.find((view) => view.id === id);
}

/**
 * The persisted view id if it still matches a known view, else the first
 * (default) view. Guards against a stale setting after a preset is renamed or
 * removed — falling back to a curated view rather than showing every column.
 */
export function resolveColumnView(views: ColumnView[], id: string | undefined): string {
  return views.find((view) => view.id === id)?.id ?? views[0]!.id;
}

/**
 * Shows/hides table columns to match `fields`. `null` shows every column
 * (the General view). `alwaysVisible` fields are shown regardless. Fields that
 * don't exist in this table are ignored, so one preset works across tables with
 * differing column sets.
 */
export function applyColumnView(
  table: Tabulator,
  fields: string[] | null,
  alwaysVisible: string[],
): void {
  const visible = fields === null ? null : new Set([...alwaysVisible, ...fields]);
  for (const column of table.getColumns()) {
    const field = column.getField();
    if (!field) {
      continue;
    }
    if (visible === null || visible.has(field)) {
      column.show();
    } else {
      column.hide();
    }
  }
  // Stock tabulator: column.show()/hide() flip cell visibility but do NOT re-run
  // the fitColumns width distribution or normalizeHeight — the flex (Name) column
  // wouldn't reclaim space freed by hidden columns and wrapped-row heights would
  // go stale. redraw() runs layoutRefresh (widths + heights) and re-renders the
  // visible window. Required — do not remove.
  table.redraw();
}

/** The field names of every column in the table, in column order. */
export function getTableFields(table: Tabulator): string[] {
  return table
    .getColumns()
    .map((column) => column.getField())
    .filter((field): field is string => !!field);
}

/** The fields currently visible in the table. */
export function getVisibleFields(table: Tabulator): string[] {
  return table
    .getColumns()
    .filter((column) => column.isVisible() && column.getField())
    .map((column) => column.getField());
}

/**
 * Toggles `field` within a view's effective field list, returning the new
 * explicit list. A `null` list (show-all) is first materialised to every table
 * field so the toggle removes exactly one column. Operating on the field list
 * (not a snapshot of one table's visible columns) preserves fields absent from
 * the current table but present in others — vital for the shared call-tree lens,
 * since Bottom-Up lacks the DML/SOQL columns.
 */
export function toggleField(
  effectiveFields: string[] | null,
  field: string,
  tableFields: string[],
): string[] {
  const base = effectiveFields === null ? [...tableFields] : [...effectiveFields];
  const index = base.indexOf(field);
  if (index >= 0) {
    base.splice(index, 1);
  } else {
    base.push(field);
  }
  return base;
}

// Leading glyphs mark checked/unchecked menu rows; the em-space keeps unchecked
// labels aligned with checked ones (ContextMenuItem has no `checked` field).
const CHECKED = '✓ ';
const UNCHECKED = '  ';

/**
 * Builds the column-header context menu: the preset views (active one ticked,
 * edited ones carrying an inline reset icon), then a per-column visibility
 * toggle for every column except the always-visible ones.
 */
export function buildColumnMenuItems(
  table: Tabulator,
  activeViewId: string,
  views: ColumnView[],
  alwaysVisible: string[],
  editedViewIds: string[],
): ContextMenuItem[] {
  const items: ContextMenuItem[] = views.map((view) => ({
    id: `view:${view.id}`,
    label: `${activeViewId === view.id ? CHECKED : UNCHECKED}${view.id}`,
    keepOpen: true,
    ...(editedViewIds.includes(view.id)
      ? { action: { id: `reset:${view.id}`, icon: 'discard', title: `Reset ${view.id} columns` } }
      : {}),
  }));

  items.push({ id: 'view-sep', label: '', separator: true });

  for (const column of table.getColumns()) {
    const field = column.getField();
    if (!field || alwaysVisible.includes(field)) {
      continue;
    }
    const title = String(column.getDefinition().title ?? field);
    items.push({
      id: `col:${field}`,
      label: title,
      checked: column.isVisible(),
      keepOpen: true,
    });
  }

  return items;
}
