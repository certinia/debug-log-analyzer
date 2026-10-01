/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
// `jest` is the global on purpose: importing it from `@jest/globals` defeats the
// hoisting the `jest.mock` calls below depend on.
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

// The shared manual mock leaves `Tabulator` out on purpose, and `RowKeyboardNavigation`
// registers against it as it loads. Nothing here constructs one.
jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
  },
  Module: class {},
  Renderer: class {},
}));

// Extends `vscode-single-select`, whose `setFormValue` needs an `ElementInternals` jsdom lacks.
jest.mock('../../../../components/VsSelect.js', () => ({}));
jest.mock('../../../settings/Settings.js', () => ({
  ...jest.requireActual<object>('../../../settings/Settings.js'),
  getSettings: () => Promise.resolve({}),
  subscribeSettings: () => () => {},
}));

import type { GridFindController } from '../../../../components/GridFindController.js';
import { SOQLView } from '../SOQLView.js';

const FOUND = { totalMatches: 3, matchIndexes: { 0: {}, 1: {} } };

/**
 * The grid without its Tabulator. `timelineRoot` and `lines` stay unset, so `updated()`
 * never reaches the build and this stands in for the table those methods read.
 *
 * What that forfeits: the build path itself, and so the row mapping, the facet value
 * lists, and the `tableBuilt` wiring that installs these filters on the table. The view
 * constructs its Tabulator inline, with no factory module to mock.
 */
function tableStub() {
  return {
    element: { clientHeight: 20 },
    find: jest.fn(async () => FOUND),
    clearFindHighlights: jest.fn(),
    refreshFilter: jest.fn(),
    download: jest.fn(),
    copyToClipboard: jest.fn(),
    deselectRow: jest.fn(),
    setSortedGroupBy: jest.fn(),
    setCurrentMatch: jest.fn(async (_index: number, _row: unknown, _options: unknown) => undefined),
  };
}

type Stub = ReturnType<typeof tableStub>;

/** `Omit` carries the public surface with the view's own types; the rest really is private. */
type Internals = Omit<SOQLView, 'soqlTable'> & {
  soqlTable: unknown;
  namespaceSelected: string[];
  objectSelected: string[];
  _finder: GridFindController;
  _handleRowCountRange(e: CustomEvent): void;
  _namespaceFilter(row: unknown): boolean;
  _objectFilter(row: unknown): boolean;
  _rowCountFilter(row: unknown): boolean;
};

describe('SOQLView', () => {
  let view: SOQLView;
  let inner: Internals;
  let table: Stub;
  let results: CustomEvent[];

  const onResults = (e: Event) => results.push(e as CustomEvent);

  const findEvent = (type: 'lv-find' | 'lv-find-close', text: string, matchCase = false) =>
    new CustomEvent(type, { detail: { text, count: 0, options: { matchCase } } });

  /** Fires the event the template binds, so the binding is under test with the handler. */
  const facetChange = (label: string, selected: string[]) =>
    view.renderRoot
      .querySelector(`datagrid-facet-filter[label="${label}"]`)
      ?.dispatchEvent(new CustomEvent('datagrid-facet-change', { detail: { selected } }));

  beforeEach(async () => {
    results = [];
    document.addEventListener('db-find-results', onResults);

    view = new SOQLView();
    document.body.append(view);
    await view.updateComplete;

    inner = view as unknown as Internals;
    table = tableStub();
    inner.soqlTable = table;
  });

  afterEach(() => {
    document.removeEventListener('db-find-results', onResults);
    view.remove();
  });

  describe('find', () => {
    it('searches the table and reports the count as its own grid', async () => {
      await inner._finder.find(findEvent('lv-find', 'update'));

      expect(table.find).toHaveBeenCalledTimes(1);
      expect(inner._finder.totalMatches).toBe(3);
      expect(results).toHaveLength(1);
      expect(results[0]?.detail).toEqual({ totalMatches: 3, type: 'soql' });
    });

    it('answers a find raised on the document, not only a direct call', async () => {
      document.dispatchEvent(findEvent('lv-find', 'update'));
      await Promise.resolve();

      expect(table.find).toHaveBeenCalledTimes(1);
    });

    it('does not search again for the same text and case option', async () => {
      await inner._finder.find(findEvent('lv-find', 'update'));
      await inner._finder.find(findEvent('lv-find', 'update'));

      expect(table.find).toHaveBeenCalledTimes(1);
    });

    it('searches again when only the case option changed', async () => {
      await inner._finder.find(findEvent('lv-find', 'update'));
      await inner._finder.find(findEvent('lv-find', 'update', true));

      expect(table.find).toHaveBeenCalledTimes(2);
    });

    it('drops the text and reports nothing upward when the widget closes', async () => {
      await inner._finder.find(findEvent('lv-find', 'update'));
      results.length = 0;

      await inner._finder.find(findEvent('lv-find-close', 'update'));

      expect(inner._finder.findArgs.text).toBe('');
      // The widget is closing, so it is not told what it would have found.
      expect(results).toHaveLength(0);
    });

    it('copies the detail rather than holding the event', async () => {
      const event = findEvent('lv-find', 'update');
      await inner._finder.find(event);

      expect(inner._finder.findArgs).not.toBe(event.detail);
      expect(inner._finder.findArgs.text).toBe('update');
    });

    it('does nothing for a hidden table that never matched', async () => {
      inner.soqlTable = { ...table, element: { clientHeight: 0 } };

      await inner._finder.find(findEvent('lv-find', 'update'));

      expect(table.find).not.toHaveBeenCalled();
    });

    it('still answers a hidden table that has matches standing', async () => {
      await inner._finder.find(findEvent('lv-find', 'update'));
      inner.soqlTable = { ...table, element: { clientHeight: 0 } };

      await inner._finder.find(findEvent('lv-find', 'insert'));

      expect(table.find).toHaveBeenCalledTimes(2);
    });
  });

  describe('stepping through the matches', () => {
    it('marks the match at the index, without scrolling or taking focus', async () => {
      await inner._finder.find(findEvent('lv-find', 'update'));

      await inner._finder.highlight(1);

      expect(table.setCurrentMatch).toHaveBeenCalledWith(1, inner._finder.findMap[1], {
        scrollIfVisible: false,
        focusRow: false,
      });
      expect(inner._finder.findArgs.count).toBe(1);
    });

    // The guard is what stops the grid's own `dataFiltering` from dropping the match.
    it('holds the guard up only while the match is being marked', async () => {
      await inner._finder.find(findEvent('lv-find', 'update'));
      let guardWhileMarking;
      table.setCurrentMatch.mockImplementation(async () => {
        guardWhileMarking = inner._finder.blockClearHighlights;
      });

      await inner._finder.highlight(1);

      expect(guardWhileMarking).toBe(true);
      expect(inner._finder.blockClearHighlights).toBe(false);
    });

    it('does nothing where the table is hidden', async () => {
      inner.soqlTable = { ...table, element: { clientHeight: 0 } };

      await inner._finder.highlight(1);

      expect(table.setCurrentMatch).not.toHaveBeenCalled();
    });
  });

  describe('dropping a search', () => {
    it('reports an empty count for its own grid', () => {
      inner._finder.reset();

      expect(results[0]?.detail).toEqual({ totalMatches: 0, type: 'soql' });
    });

    it('clears the highlights, the map and the count', async () => {
      await inner._finder.find(findEvent('lv-find', 'update'));
      results.length = 0;

      inner._finder.clear();

      expect(table.clearFindHighlights).toHaveBeenCalledTimes(1);
      expect(inner._finder.findArgs.text).toBe('');
      expect(inner._finder.findArgs.count).toBe(0);
      expect(inner._finder.findMap).toEqual({});
      expect(inner._finder.totalMatches).toBe(0);
      expect(results[0]?.detail).toEqual({ totalMatches: 0, type: 'soql' });
    });
  });

  describe('filters', () => {
    it('refreshes the grid when an object facet is picked', () => {
      facetChange('Object', ['Account']);

      expect(inner.objectSelected).toEqual(['Account']);
      expect(table.refreshFilter).toHaveBeenCalledTimes(1);
    });

    it('keeps only the picked objects, and everything when none is picked', () => {
      expect(inner._objectFilter({ objectType: 'Contact' })).toBe(true);

      facetChange('Object', ['Account']);

      expect(inner._objectFilter({ objectType: 'Account' })).toBe(true);
      expect(inner._objectFilter({ objectType: 'Contact' })).toBe(false);
    });

    it('keeps a row missing its object out of a picked facet', () => {
      facetChange('Object', ['Account']);

      expect(inner._objectFilter({})).toBe(false);
    });

    it('filters on the namespace independently of the object', () => {
      facetChange('Namespace', ['ns1']);
      facetChange('Object', ['Account']);

      const row = { objectType: 'Account', namespace: 'ns2' };

      expect(inner._objectFilter(row)).toBe(true);
      expect(inner._namespaceFilter(row)).toBe(false);
    });

    it('keeps only the rows inside a row-count range', () => {
      inner._handleRowCountRange(
        new CustomEvent('x', { detail: { range: { start: 10, end: 20 } } }),
      );

      expect(table.refreshFilter).toHaveBeenCalledTimes(1);
      expect(inner._rowCountFilter({ rowCount: 15 })).toBe(true);
      expect(inner._rowCountFilter({ rowCount: 5 })).toBe(false);
      expect(inner._rowCountFilter({ rowCount: 25 })).toBe(false);
    });
  });

  describe('the toolbar', () => {
    it('downloads a named CSV with a byte-order mark', () => {
      inner._exportToCSV();

      expect(table.download).toHaveBeenCalledWith('csv', 'soql.csv', {
        bom: true,
        delimiter: ',',
      });
    });

    it('copies every row, not the page on screen', () => {
      inner._copyToClipboard();

      expect(table.copyToClipboard).toHaveBeenCalledWith('all');
    });

    it('groups by the field behind the chosen label', () => {
      inner._soqlGroupBy({ target: { value: 'Caller Namespace' } } as unknown as Event);

      expect(table.setSortedGroupBy).toHaveBeenCalledWith('callerNamespace');
    });

    it('groups by nothing for the None label', () => {
      inner._soqlGroupBy({ target: { value: 'None' } } as unknown as Event);

      expect(table.setSortedGroupBy).toHaveBeenCalledWith('');
    });
  });

  // The shared templates render through a nested result, so what is checked here
  // is that the elements still land as direct children of the bar, carrying the
  // slot that puts them where they belong.
  describe('shared toolbar templates', () => {
    const bar = () => view.renderRoot.querySelector('datagrid-filter-bar');

    it('slots the column-view select into the bar', () => {
      const select = view.renderRoot.querySelector('#soql-column-view');

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
      inner.deselectRows();

      expect(table.deselectRow).toHaveBeenCalledTimes(1);
    });

    it('answers false where this grid has no table yet', () => {
      inner.soqlTable = null;

      expect(inner.selectByEventIndex(7)).toBe(false);
    });
  });
});
