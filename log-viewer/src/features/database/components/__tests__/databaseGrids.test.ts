/**
 * @vitest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The shared manual mock leaves `Tabulator` out on purpose, and `RowKeyboardNavigation`
// registers against it as it loads. Nothing here constructs one.
vi.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
  },
  Module: class {},
  KeybindingsModule: class {},
  SelectRowModule: class {},
  Renderer: class {},
}));

// Extends `vscode-single-select`, whose `setFormValue` needs an `ElementInternals` jsdom lacks.
vi.mock('../../../../components/VsSelect.js', () => ({}));
vi.mock('../../../settings/Settings.js', async () => ({
  ...(await vi.importActual<object>('../../../settings/Settings.js')),
  getSettings: () => Promise.resolve({}),
  subscribeSettings: () => () => {},
}));

import type { LitElement } from 'lit';

import { DMLView } from '../DMLView.js';
import { SOQLView } from '../SOQLView.js';
import { SOSLView } from '../SOSLView.js';

interface Facet {
  label: string;
  selected: string;
  filter: string;
  field: string;
}

type GridView = LitElement & {
  deselectRows(): void;
  selectByEventIndex(eventIndex: number): boolean;
};

interface Grid {
  make: () => GridView;
  table: string;
  type: string;
  facets: Facet[];
}

const OBJECT: Facet = {
  label: 'Object',
  selected: 'objectSelected',
  filter: '_objectFilter',
  field: 'objectType',
};
const NAMESPACE: Facet = {
  label: 'Namespace',
  selected: 'namespaceSelected',
  filter: '_namespaceFilter',
  field: 'namespace',
};

const GRIDS: Array<[string, Grid]> = [
  [
    'SOQLView',
    {
      make: () => new SOQLView(),
      table: 'soqlTable',
      type: 'soql',
      facets: [OBJECT, NAMESPACE],
    },
  ],
  [
    'DMLView',
    {
      make: () => new DMLView(),
      table: 'dmlTable',
      type: 'dml',
      facets: [
        OBJECT,
        {
          label: 'Caller Namespace',
          selected: 'callerNamespaceSelected',
          filter: '_callerNamespaceFilter',
          field: 'callerNamespace',
        },
      ],
    },
  ],
  [
    'SOSLView',
    {
      make: () => new SOSLView(),
      table: 'soslTable',
      type: 'sosl',
      facets: [NAMESPACE],
    },
  ],
];

// No `lines`, so `updated()` never builds: the row mapping and the `tableBuilt` filter wiring go untested.
function tableStub() {
  return {
    element: { clientHeight: 20 },
    find: vi.fn(async () => ({ totalMatches: 3, matchIndexes: { 0: {}, 1: {} } })),
    clearFindHighlights: vi.fn(),
    refreshFilter: vi.fn(),
    download: vi.fn(),
    copyToClipboard: vi.fn(),
    deselectRow: vi.fn(),
    setSortedGroupBy: vi.fn(),
  };
}

describe.each(GRIDS)('%s', (_name, grid) => {
  let view: GridView;
  let inner: Record<string, unknown>;
  let table: ReturnType<typeof tableStub>;

  // The filters are installed on the table in `tableBuilt`, so they are read by name.
  const filter = (name: string, row: object): unknown =>
    (inner[name] as (row: object) => unknown).call(view, row);

  // Each fires the event the template binds, so the binding is under test with the handler.
  const fire = (selector: string, event: Event) =>
    view.renderRoot.querySelector(selector)?.dispatchEvent(event);
  const facetChange = (label: string, selected: string[]) =>
    fire(
      `datagrid-facet-filter[label="${label}"]`,
      new CustomEvent('datagrid-facet-change', { detail: { selected } }),
    );
  const clickButton = (label: string) =>
    view.renderRoot.querySelector<HTMLElement>(`vscode-toolbar-button[label="${label}"]`)?.click();

  beforeEach(async () => {
    view = grid.make();
    document.body.append(view);
    await view.updateComplete;

    inner = view as unknown as Record<string, unknown>;
    table = tableStub();
    inner[grid.table] = table;
  });

  afterEach(() => {
    view.remove();
  });

  it('searches its own table and reports the count as its own grid', async () => {
    const reported = new Promise((resolve) =>
      document.addEventListener('db-find-results', (e) => resolve((e as CustomEvent).detail), {
        once: true,
      }),
    );

    document.dispatchEvent(
      new CustomEvent('lv-find', {
        detail: { text: 'update', count: 0, options: { matchCase: false } },
      }),
    );

    expect(await reported).toEqual({ totalMatches: 3, type: grid.type });
    expect(table.find).toHaveBeenCalledTimes(1);
  });

  describe.each(grid.facets.map((facet) => [facet.label, facet] as const))(
    'the %s facet',
    (label, facet) => {
      it('refreshes the grid when picked', () => {
        facetChange(label, ['a']);

        expect(inner[facet.selected]).toEqual(['a']);
        expect(table.refreshFilter).toHaveBeenCalledTimes(1);
      });

      it('keeps only the picked values, and everything when none is picked', () => {
        expect(filter(facet.filter, { [facet.field]: 'b' })).toBe(true);

        facetChange(label, ['a']);

        expect(filter(facet.filter, { [facet.field]: 'a' })).toBe(true);
        expect(filter(facet.filter, { [facet.field]: 'b' })).toBe(false);
      });

      it('keeps a row missing the field out of a picked facet', () => {
        facetChange(label, ['a']);

        expect(filter(facet.filter, {})).toBe(false);
      });
    },
  );

  if (grid.facets.length > 1) {
    it('filters on each facet independently', () => {
      const [first, second] = grid.facets as [Facet, Facet];
      facetChange(first.label, ['a']);
      facetChange(second.label, ['x']);

      const row = { [first.field]: 'a', [second.field]: 'y' };

      expect(filter(first.filter, row)).toBe(true);
      expect(filter(second.filter, row)).toBe(false);
    });
  }

  it('keeps only the rows inside a row-count range', () => {
    fire(
      'datagrid-range-filter[label="Row Count"]',
      new CustomEvent('datagrid-range-change', { detail: { range: { start: 10, end: 20 } } }),
    );

    expect(table.refreshFilter).toHaveBeenCalledTimes(1);
    expect(filter('_rowCountFilter', { rowCount: 15 })).toBe(true);
    expect(filter('_rowCountFilter', { rowCount: 5 })).toBe(false);
    expect(filter('_rowCountFilter', { rowCount: 25 })).toBe(false);
  });

  describe('the toolbar', () => {
    it('downloads a named CSV with a byte-order mark', () => {
      clickButton('Export to CSV');

      expect(table.download).toHaveBeenCalledWith('csv', `${grid.type}.csv`, {
        bom: true,
        delimiter: ',',
      });
    });

    it('copies every row, not the page on screen', () => {
      clickButton('Copy to clipboard');

      expect(table.copyToClipboard).toHaveBeenCalledWith('all');
    });

    it.each([
      ['the field behind the chosen label', 'Caller Namespace', 'callerNamespace'],
      ['nothing for the None label', 'None', ''],
    ])('groups by %s', (_label, value, field) => {
      // `vs-select` is mocked out, so `value` is a plain property the handler reads back.
      const dropdown = view.renderRoot.querySelector(`#${grid.type}-groupby-dropdown`);
      Object.assign(dropdown ?? {}, { value });
      dropdown?.dispatchEvent(new Event('change'));

      expect(table.setSortedGroupBy).toHaveBeenCalledWith(field);
    });
  });

  // The shared templates render through a nested result, so what is checked here
  // is that the elements still land as direct children of the bar, carrying the
  // slot that puts them where they belong.
  describe('shared toolbar templates', () => {
    const bar = () => view.renderRoot.querySelector('datagrid-filter-bar');

    it('slots the column-view select into the bar', () => {
      const select = view.renderRoot.querySelector(`#${grid.type}-column-view`);

      expect(select?.getAttribute('slot')).toBe('table-actions');
      expect(select?.parentElement).toBe(bar());
    });

    it('slots the action buttons into the bar', () => {
      const actions = view.renderRoot.querySelector('div[slot="actions"]');

      expect(actions?.parentElement).toBe(bar());
      expect(actions?.querySelectorAll('vscode-toolbar-button')).toHaveLength(3);
    });
  });

  describe('selection', () => {
    it('drops the row highlight', () => {
      view.deselectRows();

      expect(table.deselectRow).toHaveBeenCalledTimes(1);
    });

    it('answers false where this grid has no table yet', () => {
      inner[grid.table] = null;

      expect(view.selectByEventIndex(7)).toBe(false);
    });
  });
});
