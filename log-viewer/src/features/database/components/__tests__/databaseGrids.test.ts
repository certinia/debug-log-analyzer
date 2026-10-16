/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

// Extends `vscode-single-select`, whose `setFormValue` needs an `ElementInternals` jsdom lacks.
jest.mock('../../../../components/VsSelect.js', () => ({}));
jest.mock('../../../settings/Settings.js', () => ({
  ...jest.requireActual<object>('../../../settings/Settings.js'),
  getSettings: () => Promise.resolve({}),
  subscribeSettings: () => () => {},
}));
jest.mock('../../../../components/grid/exportCsv.js', () => ({ exportCsv: jest.fn() }));
jest.mock('../../../call-tree/navigation.js', () => ({ goToRow: jest.fn() }));

import type { AppGrid } from '../../../../components/grid/AppGrid.js';
import { ContextMenu } from '../../../../components/ContextMenu.js';
import { exportCsv } from '../../../../components/grid/exportCsv.js';
import { Group } from '../../../../grid/index.js';
import {
  DML_VIEWS,
  SOQL_VIEWS,
  SOSL_VIEWS,
  type ColumnView,
} from '../../../../tabulator/ColumnViews.js';
import { goToRow } from '../../../call-tree/navigation.js';
import { DMLView } from '../DMLView.js';
import { SOQLView } from '../SOQLView.js';
import { SOSLView } from '../SOSLView.js';
import type { StatementGrid, StatementRow } from '../StatementGrid.js';

type Row = StatementRow & Record<string, unknown>;
type View = StatementGrid<Row, unknown>;

interface Facet {
  label: string;
  field: string;
}

interface Grid {
  make: () => HTMLElement;
  type: string;
  facets: Facet[];
  views: ColumnView[];
}

const OBJECT: Facet = { label: 'Object', field: 'objectType' };
const NAMESPACE: Facet = { label: 'Namespace', field: 'namespace' };

const GRIDS: Array<[string, Grid]> = [
  [
    'SOQLView',
    { make: () => new SOQLView(), type: 'soql', facets: [OBJECT, NAMESPACE], views: SOQL_VIEWS },
  ],
  [
    'DMLView',
    {
      make: () => new DMLView(),
      type: 'dml',
      facets: [{ label: 'Caller Namespace', field: 'callerNamespace' }, OBJECT],
      views: DML_VIEWS,
    },
  ],
  [
    'SOSLView',
    { make: () => new SOSLView(), type: 'sosl', facets: [NAMESPACE], views: SOSL_VIEWS },
  ],
];

/** One stand-in carries what each of the three line types reads. */
function line(eventIndex: number, rows: number, ns: string, object: string) {
  return {
    eventIndex,
    text: `SELECT Id FROM ${object}`,
    namespace: ns,
    parent: { namespace: `${ns}-caller` },
    sObjectType: object,
    aggregations: 0,
    children: [{ sObjectType: object, relativeCost: 0.5 }],
    soqlRowCount: { self: rows },
    dmlRowCount: { self: rows },
    soslRowCount: { self: rows },
    duration: { total: rows * 1_000_000 },
  };
}

const LINES = [line(1, 5, 'ns1', 'Account'), line(2, 15, 'ns2', 'Contact')];

describe.each(GRIDS)('%s', (_name, spec) => {
  let view: View;

  const grid = (): AppGrid<Row> => {
    const found = view.grid;
    if (!found) {
      throw new Error('grid not shown');
    }
    return found;
  };
  const rows = (): Row[] => grid().source?.roots as Row[];
  /** The rows every filter on the grid keeps. */
  const kept = (): number[] =>
    rows()
      .filter((row) => grid().filters.every((filter) => filter.test(row)))
      .map((row) => row.eventIndex);

  // Each fires the event the template binds, so the binding is under test with the handler.
  const fire = async (selector: string, event: Event) => {
    view.renderRoot.querySelector(selector)?.dispatchEvent(event);
    await view.updateComplete;
  };
  const facetChange = (label: string, selected: string[]) =>
    fire(
      `datagrid-facet-filter[label="${label}"]`,
      new CustomEvent('datagrid-facet-change', { detail: { selected } }),
    );
  const clickButton = (label: string) =>
    view.renderRoot.querySelector<HTMLElement>(`vscode-toolbar-button[label="${label}"]`)?.click();
  const heard = (type: string): unknown[] => {
    const seen: unknown[] = [];
    view.addEventListener(type, (e) => seen.push((e as CustomEvent).detail));
    return seen;
  };

  beforeEach(async () => {
    view = spec.make() as unknown as View;
    view.lines = LINES;
    document.body.append(view);
    await view.updateComplete;
  });

  afterEach(() => {
    view.remove();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('shows one row per statement, keyed by its event', () => {
    expect(rows().map((row) => grid().source?.key(row))).toEqual([1, 2]);
    expect(rows().map((row) => row.rowCount)).toEqual([5, 15]);
    expect(rows().map((row) => row.callerNamespace)).toEqual(['ns1-caller', 'ns2-caller']);
  });

  describe.each(spec.facets.map((facet) => [facet.label, facet] as const))(
    'the %s facet',
    (label, facet) => {
      const value = (eventIndex: number) =>
        rows().find((row) => row.eventIndex === eventIndex)?.[facet.field];

      it('keeps only the picked values, and everything when none is picked', async () => {
        await facetChange(label, [String(value(2))]);
        expect(kept()).toEqual([2]);

        await facetChange(label, []);
        expect(grid().filters).toEqual([]);
        expect(kept()).toEqual([1, 2]);
      });

      it('keeps a row missing the field out of a picked facet', async () => {
        await facetChange(label, [String(value(1))]);

        expect(grid().filters[0]?.test({ ...rows()[0], [facet.field]: null } as Row)).toBe(false);
      });
    },
  );

  if (spec.facets.length > 1) {
    it('filters on each facet independently', async () => {
      const [first, second] = spec.facets as [Facet, Facet];
      const [one, two] = rows() as [Row, Row];
      await facetChange(first.label, [String(one[first.field])]);
      await facetChange(second.label, [String(two[second.field])]);

      expect(grid().filters).toHaveLength(2);
      expect(kept()).toEqual([]);
    });
  }

  it('keeps only the rows inside a row-count range', async () => {
    const range = (start: number | null, end: number | null) =>
      fire(
        'datagrid-range-filter[label="Row Count"]',
        new CustomEvent('datagrid-range-change', { detail: { range: { start, end } } }),
      );

    await range(10, 20);
    expect(kept()).toEqual([2]);

    await range(null, null);
    expect(grid().filters).toEqual([]);
  });

  it('keeps a filter object until its input changes', async () => {
    await facetChange(spec.facets[0]?.label ?? '', ['x']);
    const before = grid().filters[0];

    await fire(
      'datagrid-range-filter[label="Row Count"]',
      new CustomEvent('datagrid-range-change', { detail: { range: { start: 1, end: 2 } } }),
    );

    expect(grid().filters[0]).toBe(before);
  });

  describe('the toolbar', () => {
    it('downloads a CSV named for its statement type', () => {
      clickButton('Export to CSV');

      expect(exportCsv).toHaveBeenCalledWith(grid(), `${spec.type}.csv`);
    });

    it('copies through the grid', () => {
      const copy = jest.spyOn(grid(), 'copy').mockResolvedValue(undefined);
      clickButton('Copy to clipboard');

      expect(copy).toHaveBeenCalledTimes(1);
    });

    it('starts grouped by the statement', () => {
      expect(grid().groupBy?.(rows()[1] as Row)).toBe(rows()[1]?.[spec.type]);
    });

    it.each([
      ['the field behind the chosen label', 'Caller Namespace', 'ns2-caller'],
      ['nothing for the None label', 'None', null],
    ])('groups by %s', async (_label, value, key) => {
      // `vs-select` is mocked out, so `value` is a plain property the handler reads back.
      const dropdown = view.renderRoot.querySelector(`#${spec.type}-groupby-dropdown`);
      Object.assign(dropdown ?? {}, { value });
      await fire(`#${spec.type}-groupby-dropdown`, new Event('change'));

      expect(grid().groupBy?.(rows()[1] as Row) ?? null).toBe(key);
    });

    it('shows the columns of the chosen view, and the statement always', async () => {
      const chosen = spec.views[spec.views.length - 1] as ColumnView;
      const select = view.renderRoot.querySelector(`#${spec.type}-column-view`);
      Object.assign(select ?? {}, { value: chosen.id });
      await fire(`#${spec.type}-column-view`, new Event('change'));
      await grid().updateComplete;

      const shown = grid()
        .columns.filter((column) => !column.hidden)
        .map((column) => column.id);
      expect(shown.sort()).toEqual([spec.type, ...(chosen.fields ?? [])].sort());
    });
  });

  // The shared templates render through a nested result, so what is checked here
  // is that the elements still land as direct children of the bar, carrying the
  // slot that puts them where they belong.
  describe('shared toolbar templates', () => {
    const bar = () => view.renderRoot.querySelector('datagrid-filter-bar');

    it('slots the column-view select into the bar', () => {
      const select = view.renderRoot.querySelector(`#${spec.type}-column-view`);

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
      const deselect = jest.spyOn(grid(), 'deselect');
      view.deselectRows();

      expect(deselect).toHaveBeenCalledTimes(1);
    });

    it('knows the statements it holds', () => {
      expect([view.owns(2), view.owns(7)]).toEqual([true, false]);
    });

    it('selects a statement, scrolling only when its row is out of view', async () => {
      const goTo = jest.spyOn(grid(), 'goTo').mockResolvedValue(true);

      expect(await view.selectByEventIndex(2)).toBe(true);
      expect(goTo).toHaveBeenCalledWith([2], { scrollIfVisible: false });
    });

    it('marks only its own rows under the inspector pointer', async () => {
      view.markLocated([2, 7]);
      await view.updateComplete;

      expect([...grid().marked]).toEqual([2]);
    });

    it('keeps its mark when offered one it holds none of', async () => {
      const before = grid().marked;
      view.markLocated([7]);
      await view.updateComplete;

      expect(grid().marked).toBe(before);
    });
  });

  describe('reports', () => {
    const fromGrid = (type: string, detail: unknown) =>
      grid().dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));

    it('reports a picked row as its statement type and event', () => {
      const seen = heard('grid-selection');
      fromGrid('lv-grid-select', { row: rows()[1], target: rows()[1] });
      fromGrid('lv-grid-select', { row: null, target: null });

      expect(seen).toEqual([
        { type: spec.type, eventIndex: 2 },
        { type: spec.type, eventIndex: null },
      ]);
    });

    it('says nothing for a picked group row', () => {
      const seen = heard('grid-selection');
      fromGrid('lv-grid-select', { row: null, target: new Group('k', [], {}) });

      expect(seen).toEqual([]);
    });

    it('reports the row under the pointer, and nothing once it leaves', () => {
      const seen = heard('grid-locate');
      fromGrid('lv-grid-locate', { row: rows()[0] });
      fromGrid('lv-grid-locate', { row: null });

      expect(seen).toEqual([{ eventIndexes: [1] }, { eventIndexes: [] }]);
    });

    it('reports a reshape', () => {
      const seen = heard('grid-reshape');
      fromGrid('lv-grid-reshape', { reason: 'sort' });

      expect(seen).toEqual([null]);
    });
  });

  describe('the row menu', () => {
    let show: jest.SpyInstance;

    beforeEach(() => {
      show = jest.spyOn(ContextMenu.prototype, 'show').mockImplementation(() => {});
    });

    const rightClick = (row: Row | null) => {
      const event = new MouseEvent('contextmenu', { cancelable: true });
      grid().dispatchEvent(
        new CustomEvent('lv-grid-context', { detail: { row, event }, bubbles: true }),
      );
      return event;
    };

    it('selects the row it opens on, and shows the menu there', () => {
      const goTo = jest.spyOn(grid(), 'goTo').mockResolvedValue(true);

      expect(rightClick(rows()[1] as Row).defaultPrevented).toBe(true);
      expect(goTo).toHaveBeenCalledWith([2], { scrollIfVisible: false });
      expect(show).toHaveBeenCalledTimes(1);
    });

    it('leaves the browser menu for a group row', () => {
      expect(rightClick(null).defaultPrevented).toBe(false);
      expect(show).not.toHaveBeenCalled();
    });

    it('leaves the browser menu while text is selected, so it can be copied', () => {
      jest.spyOn(window, 'getSelection').mockReturnValue({ type: 'Range' } as Selection);

      expect(rightClick(rows()[0] as Row).defaultPrevented).toBe(false);
      expect(show).not.toHaveBeenCalled();
    });

    it('shows the statement it opened on in the Call Tree', () => {
      jest.spyOn(grid(), 'goTo').mockResolvedValue(true);
      rightClick(rows()[1] as Row);
      view.renderRoot
        .querySelector('context-menu')
        ?.dispatchEvent(
          new CustomEvent('menu-select', { detail: { itemId: 'show-in-call-tree' } }),
        );

      expect(goToRow).toHaveBeenCalledWith({ eventIndex: 2 });
    });
  });
});
