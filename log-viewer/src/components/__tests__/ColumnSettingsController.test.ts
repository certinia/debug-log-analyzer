/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { Tabulator } from 'tabulator-tables';

// The controller reads and writes settings through the extension host, which this
// suite answers for.
jest.mock('../../features/settings/Settings.js', () => ({
  getSettings: () => {
    reads++;
    return Promise.resolve(stored);
  },
  updateSetting: (section: string, value: unknown) => written.push([section, value]),
}));

import { ColumnSettingsController } from '../ColumnSettingsController.js';
import { getVisibleFields, type ColumnView } from '../../tabulator/ColumnViews.js';
import { FakeHost } from './controllerHostStub.js';

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

/** @param laidOut a table a hidden tab never rendered reports no height. */
function fakeTable(laidOut = true): Tabulator {
  const columns = FIELDS.map((field) => new FakeColumn(field));
  return {
    getColumns: () => columns,
    redraw: () => {},
    element: { clientHeight: laidOut ? 100 : 0 },
  } as unknown as Tabulator;
}

/** A connected controller over `table`, with settings already read. */
async function connected(
  table: Tabulator | null = fakeTable(),
): Promise<{ host: FakeHost; columns: ColumnSettingsController }> {
  const host = new FakeHost();
  const columns = new ColumnSettingsController(host, {
    section: 'database.soql',
    read: (settings) => (settings as { database?: { soql?: object } }).database?.soql,
    views: VIEWS,
    alwaysVisible: ALWAYS_VISIBLE,
    tables: () => (table ? [table] : []),
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
    expect(getVisibleFields(table)).toEqual(['text', 'timeTaken']);
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
    expect(getVisibleFields(table)).toEqual(['text', 'timeTaken']);
    expect(written).toEqual([['database.soql.columnView', 'Timing']]);
  });

  it('takes a column out of the view on show, and remembers it', async () => {
    const table = fakeTable();
    const { columns } = await connected(table);

    columns.toggle(table, 'rowCount');

    expect(columns.editedViews).toEqual(['General']);
    expect(getVisibleFields(table)).toEqual(['text', 'namespace']);
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
    expect(getVisibleFields(table)).toEqual(['text']);

    columns.reset();

    expect(columns.editedViews).toEqual([]);
    expect(getVisibleFields(table)).toEqual(['text', 'namespace', 'rowCount']);
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

  it('leaves a table no tab has laid out to its next build', async () => {
    const table = fakeTable(false);
    const { columns } = await connected(table);

    columns.choose('Timing');

    // Redrawing one of those throws, so the view waits for `applyTo`.
    expect(getVisibleFields(table)).toEqual(FIELDS);
    columns.applyTo(table);
    expect(getVisibleFields(table)).toEqual(['text', 'timeTaken']);
  });
});
