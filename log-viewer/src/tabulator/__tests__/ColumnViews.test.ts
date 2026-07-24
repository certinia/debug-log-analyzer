/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { Tabulator } from 'tabulator-tables';

import {
  applyColumnView,
  buildColumnMenuItems,
  CALL_TREE_VIEWS,
  DML_VIEWS,
  getColumnView,
  getTableFields,
  getVisibleFields,
  resolveColumnView,
  SOQL_VIEWS,
  SOSL_VIEWS,
  toggleField,
} from '../ColumnViews.js';

class FakeColumn {
  visible = true;
  field: string;
  constructor(field: string) {
    this.field = field;
  }
  getField(): string {
    return this.field;
  }
  isVisible(): boolean {
    return this.visible;
  }
  show(): void {
    this.visible = true;
  }
  hide(): void {
    this.visible = false;
  }
  getDefinition(): { title: string } {
    return { title: this.field };
  }
}

function fakeTable(fields: string[]): { table: Tabulator; columns: FakeColumn[] } {
  const columns = fields.map((f) => new FakeColumn(f));
  const table = { getColumns: () => columns, redraw: () => {} } as unknown as Tabulator;
  return { table, columns };
}

const ALWAYS_VISIBLE = ['text'];

const CALL_TREE_FIELDS = [
  'text',
  'namespace',
  'callCount',
  'dmlCount.total',
  'soqlCount.total',
  'thrownCount.total',
  'dmlRowCount.total',
  'soqlRowCount.total',
  'totalTime',
  'totalSelfTime',
  'heapPeak',
  'heapAllocated.total',
  'governorCost',
];

describe('applyColumnView', () => {
  it('General (null) shows every column', () => {
    const { table, columns } = fakeTable(CALL_TREE_FIELDS);
    columns[3]!.hide();
    applyColumnView(table, null, ALWAYS_VISIBLE);
    expect(columns.every((c) => c.isVisible())).toBe(true);
  });

  it('keeps the always-visible column shown even when not listed', () => {
    const { table, columns } = fakeTable(CALL_TREE_FIELDS);
    applyColumnView(table, ['soqlCount.total'], ALWAYS_VISIBLE);
    expect(columns.find((c) => c.getField() === 'text')!.isVisible()).toBe(true);
  });

  it('shows only listed fields (plus always-visible) and hides the rest', () => {
    const { table } = fakeTable(CALL_TREE_FIELDS);
    applyColumnView(
      table,
      ['soqlCount.total', 'soqlRowCount.total', 'governorCost'],
      ALWAYS_VISIBLE,
    );
    expect(getVisibleFields(table).sort()).toEqual(
      ['governorCost', 'soqlCount.total', 'soqlRowCount.total', 'text'].sort(),
    );
  });

  it('ignores preset fields absent from this table', () => {
    // Bottom-up lacks the count columns; the Governor Limits preset must not error.
    const { table } = fakeTable(['text', 'type', 'totalTime', 'heapPeak', 'governorCost']);
    applyColumnView(
      table,
      getColumnView(CALL_TREE_VIEWS, 'Governor Limits')!.fields,
      ALWAYS_VISIBLE,
    );
    expect(getVisibleFields(table).sort()).toEqual(['governorCost', 'heapPeak', 'text'].sort());
  });

  it('honours a non-default always-visible field (DB tables)', () => {
    const { table } = fakeTable(['soql', 'isSelective', 'rowCount', 'timeTaken']);
    applyColumnView(table, ['rowCount'], ['soql']);
    expect(getVisibleFields(table).sort()).toEqual(['rowCount', 'soql'].sort());
  });
});

describe('toggleField', () => {
  it('materialises a null (show-all) view then removes the toggled field', () => {
    const result = toggleField(null, 'namespace', CALL_TREE_FIELDS);
    expect(result).not.toContain('namespace');
    expect(result).toContain('text');
    expect(result.length).toBe(CALL_TREE_FIELDS.length - 1);
  });

  it('removes a field already present in the list', () => {
    expect(toggleField(['a', 'b', 'c'], 'b', ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });

  it('adds a field not in the list', () => {
    expect(toggleField(['a'], 'b', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('preserves fields absent from the current table (shared call-tree lens)', () => {
    // Editing on Bottom-Up (no DML/SOQL columns) must keep those fields in the list.
    const govFields = getColumnView(CALL_TREE_VIEWS, 'Governor Limits')!.fields!;
    const bottomUpFields = ['text', 'type', 'totalTime', 'governorCost'];
    const result = toggleField(govFields, 'governorCost', bottomUpFields);
    expect(result).toContain('dmlCount.total');
    expect(result).not.toContain('governorCost');
  });
});

describe('buildColumnMenuItems', () => {
  it('lists views and per-column toggles, with no standalone Reset item', () => {
    const { table } = fakeTable(['text', 'namespace', 'governorCost']);
    const items = buildColumnMenuItems(table, 'General', CALL_TREE_VIEWS, ALWAYS_VISIBLE, []);
    expect(items.some((i) => i.id === 'view:General')).toBe(true);
    expect(items.some((i) => i.id === 'col:namespace')).toBe(true);
    // Always-visible column has no toggle.
    expect(items.some((i) => i.id === 'col:text')).toBe(false);
    // Reset is now an inline per-view action, not a standalone item.
    expect(items.some((i) => i.id === 'reset')).toBe(false);
  });

  it('adds an inline reset action only to edited view rows', () => {
    const { table } = fakeTable(['text', 'namespace']);
    const items = buildColumnMenuItems(table, 'Time', CALL_TREE_VIEWS, ALWAYS_VISIBLE, ['Time']);
    expect(items.find((i) => i.id === 'view:Time')?.action?.id).toBe('reset:Time');
    expect(items.find((i) => i.id === 'view:General')?.action).toBeUndefined();
  });
});

describe('resolveColumnView', () => {
  it('returns the id when it matches a known view', () => {
    expect(resolveColumnView(CALL_TREE_VIEWS, 'Governor Limits')).toBe('Governor Limits');
  });

  it('falls back to the first view for an unknown or missing id', () => {
    expect(resolveColumnView(CALL_TREE_VIEWS, 'Renamed')).toBe(CALL_TREE_VIEWS[0]!.id);
    expect(resolveColumnView(SOQL_VIEWS, undefined)).toBe(SOQL_VIEWS[0]!.id);
  });
});

describe('view sets', () => {
  it('each view set has a General view and unique ids', () => {
    for (const views of [CALL_TREE_VIEWS, SOQL_VIEWS, DML_VIEWS]) {
      expect(getColumnView(views, 'General')).toBeDefined();
      const ids = views.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('General is an explicit curated list so Self columns stay hidden', () => {
    const general = getColumnView(CALL_TREE_VIEWS, 'General')!.fields!;
    expect(general).not.toBeNull();
    // Totals are shown; Self variants are not part of any default view.
    expect(general).toContain('dmlCount.total');
    expect(general).toContain('soqlCount.total');
    expect(general.some((f) => f.endsWith('.self') && f !== 'duration.self')).toBe(false);
  });

  it('General shows Heap (net) but omits the near-always-zero SOSL columns', () => {
    const general = getColumnView(CALL_TREE_VIEWS, 'General')!.fields!;
    expect(general).toContain('heapAllocated.total');
    expect(general).not.toContain('soslCount.total');
    expect(general).not.toContain('soslRowCount.total');
  });

  it('Database and Governor Limits merge DML, SOQL and SOSL count + row totals', () => {
    const soslTotals = ['soslCount.total', 'soslRowCount.total'];
    for (const viewId of ['Database', 'Governor Limits']) {
      const view = getColumnView(CALL_TREE_VIEWS, viewId)!.fields!;
      for (const f of [
        'dmlCount.total',
        'soqlCount.total',
        'dmlRowCount.total',
        'soqlRowCount.total',
        ...soslTotals,
      ]) {
        expect(view).toContain(f);
      }
    }
  });

  it('Memory view shows net, gross and peak heap', () => {
    const memory = getColumnView(CALL_TREE_VIEWS, 'Memory')!.fields!;
    expect(memory).toContain('heapAllocated.total');
    expect(memory).toContain('heapAllocated.self');
    expect(memory).toContain('heapGross.total');
    expect(memory).toContain('heapGross.self');
    expect(memory).toContain('heapPeak');
  });

  it('SOQL Query Plan view exposes the explain-plan columns', () => {
    const plan = getColumnView(SOQL_VIEWS, 'Query Plan')!.fields!;
    expect(plan).toEqual(
      expect.arrayContaining([
        'relativeCost',
        'leadingOperationType',
        'sObjectType',
        'cardinality',
      ]),
    );
  });

  it('SOQL views are General/Performance/Query Plan/Limits', () => {
    expect(SOQL_VIEWS.map((v) => v.id)).toEqual(['General', 'Performance', 'Query Plan', 'Limits']);
  });

  it('SOQL and DML expose the object-type column by default', () => {
    expect(getColumnView(SOQL_VIEWS, 'General')?.fields).toContain('objectType');
    expect(getColumnView(DML_VIEWS, 'General')?.fields).toContain('objectType');
  });

  it('SOSL views are General/Timing', () => {
    expect(SOSL_VIEWS.map((v) => v.id)).toEqual(['General', 'Timing']);
  });

  it('getTableFields returns every column field in order', () => {
    const { table } = fakeTable(['text', 'namespace', 'governorCost']);
    expect(getTableFields(table)).toEqual(['text', 'namespace', 'governorCost']);
  });
});
