/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  CALL_TREE_VIEWS,
  columnMenuItems,
  DML_VIEWS,
  getColumnView,
  resolveColumnView,
  SOQL_VIEWS,
  SOSL_VIEWS,
  TIME_TOTALS,
  toggleField,
  type MenuColumn,
} from '../ColumnViews.js';

const menuColumns = (fields: string[]): MenuColumn[] =>
  fields.map((field) => ({ id: field, title: field }));

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

describe('columnMenuItems', () => {
  it('lists views and per-column toggles, with no standalone Reset item', () => {
    const columns = menuColumns(['text', 'namespace', 'governorCost']);
    const items = columnMenuItems(columns, 'General', CALL_TREE_VIEWS, ALWAYS_VISIBLE, []);
    expect(items.some((i) => i.id === 'view:General')).toBe(true);
    expect(items.some((i) => i.id === 'col:namespace')).toBe(true);
    // Always-visible column has no toggle.
    expect(items.some((i) => i.id === 'col:text')).toBe(false);
    // Reset is now an inline per-view action, not a standalone item.
    expect(items.some((i) => i.id === 'reset')).toBe(false);
  });

  it('adds an inline reset action only to edited view rows', () => {
    const columns = menuColumns(['text', 'namespace']);
    const items = columnMenuItems(columns, 'Time', CALL_TREE_VIEWS, ALWAYS_VISIBLE, ['Time']);
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

  it('General keeps throws but defers heap and governor usage to their own views', () => {
    const general = getColumnView(CALL_TREE_VIEWS, 'General')!.fields!;
    expect(general).toContain('thrownCount.total');
    expect(general).not.toContain('heapAllocated.total');
    expect(general).not.toContain('heapPeak');
    // SOSL is near-always-zero, so it stays out of the everyday overview.
    expect(general).not.toContain('soslCount.total');
    expect(general).not.toContain('soslRowCount.total');
  });

  it('governorCost belongs to the Governor Limits view alone', () => {
    const owning = CALL_TREE_VIEWS.filter((v) => v.fields?.includes('governorCost'));
    expect(owning.map((v) => v.id)).toEqual(['Governor Limits']);
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

  it('Database carries timing so Governor Limits stays the pure-limits view', () => {
    const database = getColumnView(CALL_TREE_VIEWS, 'Database')!.fields!;
    const governor = getColumnView(CALL_TREE_VIEWS, 'Governor Limits')!.fields!;
    for (const f of TIME_TOTALS) {
      expect(database).toContain(f);
      expect(governor).not.toContain(f);
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
});
