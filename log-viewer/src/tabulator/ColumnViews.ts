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

/**
 * Column views for the Call Tree and Analysis tables. General is an explicit
 * curated set (not `null`) so the Self columns stay hidden by default. Time
 * fields are listed under both name variants (`totalTime`/`totalSelfTime` for
 * aggregated & bottom-up, `duration.total`/`duration.self` for time-order) so
 * one list works across all three tables.
 */
export const CALL_TREE_VIEWS: ColumnView[] = [
  {
    // SOSL is omitted here (near-always-zero for most orgs); it stays in the
    // Governor Limits and Database views and remains toggleable anywhere.
    id: 'General',
    fields: [
      'namespace',
      'callCount',
      'dmlCount.total',
      'soqlCount.total',
      'thrownCount.total',
      'dmlRowCount.total',
      'soqlRowCount.total',
      'heapAllocated.total',
      'totalTime',
      'totalSelfTime',
      'duration.total',
      'duration.self',
      'governorCost',
    ],
  },
  {
    id: 'Time',
    fields: [
      'namespace',
      'callCount',
      'totalTime',
      'totalSelfTime',
      'avgSelfTime',
      'duration.total',
      'duration.self',
      'governorCost',
    ],
  },
  {
    id: 'Governor Limits',
    fields: [
      'namespace',
      ...LIMIT_COUNT_TOTALS,
      ...LIMIT_ROW_TOTALS,
      'thrownCount.total',
      'heapAllocated.total',
      'governorCost',
      'governorCostMax',
    ],
  },
  {
    id: 'Database',
    fields: ['namespace', ...LIMIT_COUNT_TOTALS, ...LIMIT_ROW_TOTALS, 'governorCost'],
  },
  {
    id: 'Memory',
    fields: ['namespace', 'heapAllocated.self', 'heapAllocated.total', 'governorCost'],
  },
];

/** Column views for the SOQL database table. */
export const SOQL_VIEWS: ColumnView[] = [
  { id: 'General', fields: ['isSelective', 'namespace', 'rowCount', 'timeTaken', 'aggregations'] },
  { id: 'Performance', fields: ['isSelective', 'relativeCost', 'rowCount', 'timeTaken'] },
  {
    id: 'Query Plan',
    fields: ['relativeCost', 'leadingOperationType', 'sObjectType', 'cardinality'],
  },
];

/** Column views for the DML database table. */
export const DML_VIEWS: ColumnView[] = [
  { id: 'General', fields: ['callerNamespace', 'rowCount', 'timeTaken'] },
  { id: 'Timing', fields: ['rowCount', 'timeTaken'] },
];

export function getColumnView(views: ColumnView[], id: string): ColumnView | undefined {
  return views.find((view) => view.id === id);
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
  // show()/hide() alone don't re-run the fitColumns width distribution, so the
  // flex (Name) column wouldn't reclaim space freed by hidden columns. A light
  // redraw re-lays-out columns and re-renders the visible window.
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
 * Builds the column-header context menu: the preset views (active one ticked),
 * a per-column visibility toggle for every column except the always-visible
 * ones, then a Reset item (enabled only when the active view is overridden).
 */
export function buildColumnMenuItems(
  table: Tabulator,
  activeViewId: string,
  views: ColumnView[],
  alwaysVisible: string[],
  hasOverride: boolean,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = views.map((view) => ({
    id: `view:${view.id}`,
    label: `${activeViewId === view.id ? CHECKED : UNCHECKED}${view.id}`,
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
      label: `${column.isVisible() ? CHECKED : UNCHECKED}${title}`,
    });
  }

  items.push(
    { id: 'reset-sep', label: '', separator: true },
    { id: 'reset', label: 'Reset columns', disabled: !hasOverride },
  );

  return items;
}
