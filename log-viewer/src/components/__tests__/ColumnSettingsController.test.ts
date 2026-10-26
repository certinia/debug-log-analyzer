/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

// The controller reads and writes settings through the extension host, which this
// suite answers for.
jest.mock('../../features/settings/Settings.js', () => ({
  getSettings: () => {
    reads++;
    return Promise.resolve(stored);
  },
  updateSetting: (section: string, value: unknown) => written.push([section, value]),
}));

import {
  ColumnSettingsController,
  gridColumnTarget,
  heldColumnTarget,
  type ColumnTarget,
} from '../ColumnSettingsController.js';
import type { GridColumn, LvGrid } from '../../grid/index.js';
import type { ColumnView } from '../grid/ColumnViews.js';
import { fakeHost, type FakeHost } from '#test-helpers/fakeHost.js';

/** What the extension host would answer with. */
let stored: object = {};
/** How many times the host was asked. */
let reads = 0;
/** Every `updateSetting` the controller made, in order. */
let written: [string, unknown][] = [];

const VIEWS: ColumnView[] = [
  { id: 'General', fields: ['text', 'namespace', 'rowCount'] },
  { id: 'Timing', fields: ['text', 'timeTaken'] },
];
const ALWAYS_VISIBLE = ['text'];
const FIELDS = ['text', 'namespace', 'rowCount', 'timeTaken'];

/** A grid's columns as a view target, which reports the fields the view left shown. */
function fakeTable(): ColumnTarget & { visible(): string[] } {
  let shown: ReadonlySet<string> | null = null;
  const isShown = (field: string) => !shown || shown.has(field);
  return {
    columns: () => FIELDS.map((field) => ({ id: field, title: field, hidden: !isShown(field) })),
    show: (visible) => {
      shown = visible;
    },
    visible: () => FIELDS.filter(isShown),
  };
}

/** A connected controller over `table`, with settings already read. */
async function connected(
  table: ColumnTarget | null = fakeTable(),
): Promise<{ host: FakeHost; columns: ColumnSettingsController }> {
  const host = fakeHost();
  const columns = new ColumnSettingsController(host, {
    section: 'database.soql',
    read: (settings) => (settings as { database?: { soql?: object } }).database?.soql,
    views: VIEWS,
    alwaysVisible: ALWAYS_VISIBLE,
    targets: () => (table ? [table] : []),
  });
  host.connect();
  await Promise.resolve();
  return { host, columns };
}

describe('ColumnSettingsController', () => {
  beforeEach(() => {
    stored = {};
    reads = 0;
    written = [];
  });

  it('opens on the first view where nothing is stored', async () => {
    const { columns } = await connected();

    expect(columns.view).toBe('General');
    expect(columns.editedViews).toEqual([]);
  });

  it('opens on the stored view, under the stored overrides', async () => {
    stored = {
      database: { soql: { columnView: 'Timing', columnOverrides: { Timing: ['timeTaken'] } } },
    };
    const table = fakeTable();

    const { columns } = await connected(table);

    expect(columns.view).toBe('Timing');
    expect(columns.editedViews).toEqual(['Timing']);
    expect(table.visible()).toEqual(['text', 'timeTaken']);
  });

  it('falls back to the first view where the stored one is gone', async () => {
    stored = { database: { soql: { columnView: 'Retired' } } };

    const { columns } = await connected();

    expect(columns.view).toBe('General');
  });

  it('shows and remembers a chosen view', async () => {
    const table = fakeTable();
    const { columns } = await connected(table);

    columns.choose('Timing');

    expect(columns.view).toBe('Timing');
    expect(table.visible()).toEqual(['text', 'timeTaken']);
    expect(written).toEqual([['database.soql.columnView', 'Timing']]);
  });

  it('takes a column out of the view on show, and remembers it', async () => {
    const table = fakeTable();
    const { columns } = await connected(table);

    columns.toggle(table, 'rowCount');

    expect(columns.editedViews).toEqual(['General']);
    expect(table.visible()).toEqual(['text', 'namespace']);
    expect(written).toEqual([
      ['database.soql.columnOverrides', { General: ['text', 'namespace'] }],
    ]);
  });

  it('gives a view back its built-in columns', async () => {
    stored = {
      database: { soql: { columnOverrides: { General: ['text'] } } },
    };
    const table = fakeTable();
    const { columns } = await connected(table);
    expect(table.visible()).toEqual(['text']);

    columns.reset();

    expect(columns.editedViews).toEqual([]);
    expect(table.visible()).toEqual(['text', 'namespace', 'rowCount']);
    expect(written).toEqual([['database.soql.columnOverrides', {}]]);
  });

  it('writes nothing for a reset of a view the user never edited', async () => {
    const { columns } = await connected();

    columns.reset();

    expect(written).toEqual([]);
  });

  it('asks the host once, however often the view comes and goes', async () => {
    const { host, columns } = await connected();
    expect(reads).toBe(1);

    columns.choose('Timing');
    host.disconnect();
    host.connect();
    await Promise.resolve();

    // The keys are private globalState, so nothing pushes a change to re-read.
    expect(reads).toBe(1);
    expect(columns.view).toBe('Timing');
  });

  it('shows a view on an lv-grid, edits it from the grid, and lists its columns', async () => {
    const grid = {
      columns: FIELDS.map((field) => ({ id: field, title: `${field} title`, cell: () => '' })),
    } as unknown as LvGrid<object>;
    const shown = (): string[] =>
      grid.columns.filter((column) => !column.hidden).map((column) => column.id);
    const target = gridColumnTarget(grid);
    const { columns } = await connected(target);

    columns.choose('Timing');
    expect(shown()).toEqual(['text', 'timeTaken']);

    columns.toggle(target, 'namespace');
    expect(shown()).toEqual(['text', 'namespace', 'timeTaken']);
    expect(columns.editedViews).toEqual(['Timing']);

    const toggles = columns
      .menuItems(target)
      .filter((item) => item.id.startsWith('col:'))
      .map((item) => [item.id, item.label, item.checked]);
    expect(toggles).toEqual([
      ['col:namespace', 'namespace title', true],
      ['col:rowCount', 'rowCount title', false],
      ['col:timeTaken', 'timeTaken title', true],
    ]);
  });

  it('adds the width items only for a grid, and Autosize Column only from a header', async () => {
    const table = fakeTable();
    const { columns } = await connected(table);
    const WIDTH_LABELS = ['Autosize Column', 'Autosize All Columns', 'Reset Column Widths'];
    const labels = (target: ColumnTarget, column?: string): string[] =>
      columns.menuItems(target, column).map((item) => item.label.trim());
    const widthLabels = (target: ColumnTarget, column?: string): string[] =>
      labels(target, column).filter((label) => WIDTH_LABELS.includes(label));
    const grid = {
      autosizeColumn: jest.fn(),
      autosizeColumns: jest.fn(),
      resetColumnWidths: jest.fn(),
    };

    expect(widthLabels(table)).toEqual([]);
    expect(widthLabels({ ...table, grid: () => grid }, 'namespace')).toEqual([
      'Autosize Column',
      'Autosize All Columns',
      'Reset Column Widths',
    ]);
    expect(widthLabels({ ...table, grid: () => grid })).toEqual([
      'Autosize All Columns',
      'Reset Column Widths',
    ]);
    // Above the column toggles, so a long list does not push them out of view.
    const menu = labels({ ...table, grid: () => grid });
    expect(menu.indexOf('Reset Column Widths')).toBeLessThan(menu.indexOf('namespace'));
    expect(menu.indexOf('Autosize All Columns')).toBeGreaterThan(menu.indexOf('Timing'));
  });
});

describe('Seen and Reported titles', () => {
  it('name each figure while both show, and go back once Reported is hidden', async () => {
    let columns: GridColumn<object>[] = [
      { id: 'text', title: 'Name', cell: () => '' },
      { id: 'soqlCount.total', title: 'SOQL', cell: () => '' },
      { id: 'soqlCount.reported', title: 'SOQL (used)', hidden: true, cell: () => '' },
    ];
    const target = heldColumnTarget(
      () => columns,
      (next) => (columns = next),
    );
    const host = fakeHost();
    const settings = new ColumnSettingsController(host, {
      section: 'callTree',
      read: () => undefined,
      views: [{ id: 'General', fields: ['soqlCount.total'] }],
      alwaysVisible: ['text'],
      pairs: [{ seen: 'soqlCount.total', reported: 'soqlCount.reported', label: 'SOQL' }],
      targets: () => [target],
    });
    host.connect();
    await Promise.resolve();
    const titles = (): string[] => columns.filter((c) => !c.hidden).map((c) => c.title);

    expect(titles()).toEqual(['Name', 'SOQL']);

    settings.toggle(target, 'soqlCount.reported');
    expect(titles()).toEqual(['Name', 'SOQL (seen)', 'SOQL (used)']);

    settings.toggle(target, 'soqlCount.reported');
    expect(titles()).toEqual(['Name', 'SOQL']);
  });
});
