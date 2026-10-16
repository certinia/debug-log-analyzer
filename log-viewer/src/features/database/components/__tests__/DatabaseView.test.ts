/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import {
  eventBus,
  type DetailSelection,
  type DetailSource,
  type StatementType,
} from '../../../../core/events/EventBus.js';

// The three grids and the summary bring lv-grid and its stylesheets with them;
// this suite only drives the selection and find contracts between them and DatabaseView.
jest.mock('../DMLView.js', () => ({}));
jest.mock('../SOQLView.js', () => ({}));
jest.mock('../SOSLView.js', () => ({}));
jest.mock('../GovernorSummary.js', () => ({}));
jest.mock('../DatabaseSection.js', () => ({}));

import '../DatabaseView.js';

/** The lv-grid slice find drives. */
interface FakeLvGrid {
  matches: number;
  clientHeight: number;
  current: number[];
  cleared: number;
  find(): Promise<number>;
  setCurrentMatch(index: number): Promise<void>;
  clearFind(): void;
}

/** The slice of a grid DatabaseView drives, standing in for the real element. */
interface FakeGrid extends HTMLElement {
  deselects: number;
  ownedIndex: number | null;
  marked: readonly number[][];
  grid: FakeLvGrid;
}

function fakeLvGrid(matches = 0): FakeLvGrid {
  const grid: FakeLvGrid = {
    matches,
    clientHeight: 10,
    current: [],
    cleared: 0,
    find: async () => grid.matches,
    setCurrentMatch: async (index) => void grid.current.push(index),
    clearFind: () => void (grid.cleared += 1),
  };
  return grid;
}

/**
 * The grids render only once a log is loaded, so stand-ins are placed in the
 * shadow root the same way: one element per statement type, found by tag.
 */
function fakeGrid(tag: string, ownedIndex: number | null = null): FakeGrid {
  const grid = document.createElement(tag) as FakeGrid;
  grid.deselects = 0;
  grid.ownedIndex = ownedIndex;
  grid.marked = [];
  grid.grid = fakeLvGrid();
  Object.assign(grid, {
    deselectRows: () => (grid.deselects += 1),
    owns: (eventIndex: number) => eventIndex === grid.ownedIndex,
    selectByEventIndex: async (eventIndex: number) => eventIndex === grid.ownedIndex,
    markLocated: (eventIndexes: readonly number[]) => {
      grid.marked = [...grid.marked, [...eventIndexes]];
    },
  });
  return grid;
}

describe('database-view selection', () => {
  let view: HTMLElement;
  let grids: Record<StatementType, FakeGrid>;
  let seen: Array<{ source: DetailSource; selection: DetailSelection | null }>;
  let off: () => void;

  beforeEach(async () => {
    document.body.replaceChildren();
    view = document.createElement('database-view');
    document.body.append(view);
    await (view as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    grids = {
      dml: fakeGrid('dml-view'),
      soql: fakeGrid('soql-view', 42),
      sosl: fakeGrid('sosl-view'),
    };
    view.shadowRoot?.append(grids.dml, grids.soql, grids.sosl);
    seen = [];
    off = eventBus.on('detail:select', (d) => seen.push(d));
  });

  afterEach(() => {
    off();
    document.body.replaceChildren();
  });

  /** The grids report upward; DatabaseView alone turns that into a selection. */
  const report = (type: StatementType, eventIndex: number | null) =>
    grids[type].dispatchEvent(
      new CustomEvent('grid-selection', { detail: { type, eventIndex }, bubbles: true }),
    );

  it('reports a picked row and clears the other two grids', () => {
    report('soql', 7);

    expect(seen).toEqual([
      { source: 'database', selection: { kind: 'event', eventIndex: 7, type: 'soql' } },
    ]);
    expect([grids.dml.deselects, grids.soql.deselects, grids.sosl.deselects]).toEqual([1, 0, 1]);
  });

  it('says nothing for the clears its own pick caused', () => {
    // The two cleared grids report their nulls; arriving after the pick, they
    // would undo it.
    grids.dml.addEventListener('grid-selection', () => report('dml', null));
    report('soql', 7);

    expect(seen).toHaveLength(1);
  });

  it('clears the inspector when the grid holding the selection is cleared', () => {
    report('soql', null);

    expect(seen).toEqual([{ source: 'database', selection: null }]);
  });

  it('says nothing for the select the inspector asked for', async () => {
    // The revealed grid reports the selection it was just given, after its scroll settles.
    Object.assign(grids.soql, {
      selectByEventIndex: async () => {
        await Promise.resolve();
        report('soql', 42);
        return true;
      },
    });

    eventBus.emit('inspector:reveal', { source: 'database', eventIndex: 42 });
    await new Promise((resolve) => setTimeout(resolve));

    expect(seen).toEqual([]);
    // The owner is cleared too, so a pick a filter now hides does not stay.
    expect([grids.dml.deselects, grids.soql.deselects, grids.sosl.deselects]).toEqual([1, 1, 1]);
  });

  it('reveals nothing for a statement no grid holds', async () => {
    eventBus.emit('inspector:reveal', { source: 'database', eventIndex: 99 });
    await new Promise((resolve) => setTimeout(resolve));

    expect([grids.dml.deselects, grids.soql.deselects, grids.sosl.deselects]).toEqual([0, 0, 0]);
  });

  it('drops every grid selection on an app-wide clear', () => {
    eventBus.emit('selection:clear', { source: 'database' });

    expect([grids.dml.deselects, grids.soql.deselects, grids.sosl.deselects]).toEqual([1, 1, 1]);
  });

  describe('the pointer', () => {
    let located: Array<{ source: DetailSource; eventIndexes: readonly number[] }>;
    let offLocate: () => void;

    beforeEach(() => {
      located = [];
      offLocate = eventBus.on('detail:locate', (d) => located.push(d));
    });

    afterEach(() => offLocate());

    it('reports the row it is over, and nothing when it leaves', () => {
      grids.soql.dispatchEvent(
        new CustomEvent('grid-locate', { detail: { eventIndexes: [7] }, bubbles: true }),
      );
      grids.soql.dispatchEvent(
        new CustomEvent('grid-locate', { detail: { eventIndexes: [] }, bubbles: true }),
      );

      expect(located).toEqual([
        { source: 'database', eventIndexes: [7] },
        { source: 'database', eventIndexes: [] },
      ]);
      // A mark is not a pick: no grid was selected or cleared.
      expect([grids.dml.deselects, grids.soql.deselects, grids.sosl.deselects]).toEqual([0, 0, 0]);
    });

    it('offers the inspector mark to every grid, since one of them owns it', () => {
      eventBus.emit('inspector:locate', { source: 'database', eventIndexes: [42], sticky: false });

      expect([grids.dml.marked, grids.soql.marked, grids.sosl.marked]).toEqual([
        [[42]],
        [[42]],
        [[42]],
      ]);
    });

    it('ignores a mark meant for another tab', () => {
      eventBus.emit('inspector:locate', { source: 'calltree', eventIndexes: [42], sticky: false });

      expect(grids.soql.marked).toEqual([]);
    });

    it('holds a picked row mark once the pointer leaves', () => {
      eventBus.emit('inspector:locate', { source: 'database', eventIndexes: [42], sticky: true });
      eventBus.emit('inspector:locate', { source: 'database', eventIndexes: [7], sticky: false });
      eventBus.emit('inspector:locate', { source: 'database', eventIndexes: [], sticky: false });

      expect(grids.soql.marked).toEqual([[42], [7], [42]]);
    });

    it('drops a picked row mark on an app-wide clear', () => {
      eventBus.emit('inspector:locate', { source: 'database', eventIndexes: [42], sticky: true });
      eventBus.emit('selection:clear', { source: 'database' });

      expect(grids.soql.marked).toEqual([[42], []]);
    });
  });
});

describe('database-view find', () => {
  let view: HTMLElement & { updateComplete: Promise<unknown> };
  let grids: [FakeGrid, FakeGrid, FakeGrid];

  beforeEach(async () => {
    document.body.replaceChildren();
    view = document.createElement('database-view') as typeof view;
    document.body.append(view);
    await view.updateComplete;
    grids = [fakeGrid('dml-view'), fakeGrid('soql-view'), fakeGrid('sosl-view')];
    view.shadowRoot?.append(...grids);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  /** The totals DatabaseView reports to the find widget while `run` settles. */
  async function rollUps(run: () => void): Promise<number[]> {
    const seen: number[] = [];
    const probe = (e: Event) =>
      void seen.push((e as CustomEvent<{ totalMatches: number }>).detail.totalMatches);
    document.addEventListener('lv-find-results', probe);
    run();
    await new Promise((resolve) => setTimeout(resolve));
    document.removeEventListener('lv-find-results', probe);
    return seen;
  }

  const search = (count = 1) =>
    document.dispatchEvent(
      new CustomEvent('lv-find', {
        detail: { text: 'update', count, options: { matchCase: false } },
      }),
    );

  /** Sections render in view order: DML, SOQL, SOSL. */
  const collapse = (index: number) =>
    view.shadowRoot
      ?.querySelectorAll('database-section')
      [index]?.dispatchEvent(new CustomEvent('section-toggle'));

  it("reports the three grids' matches as one total", async () => {
    grids.forEach((grid, i) => (grid.grid.matches = i + 1));

    expect(await rollUps(() => search())).toEqual([6]);
  });

  it('marks the current match in the grid that holds it, counting in view order', async () => {
    grids.forEach((grid) => (grid.grid.matches = 2));

    await rollUps(() => search(3));

    expect(grids.map((grid) => grid.grid.current)).toEqual([[-1], [0], [-1]]);
  });

  it('skips a grid that is not shown', async () => {
    grids.forEach((grid) => (grid.grid.matches = 2));
    grids[1].grid.clientHeight = 0;

    expect(await rollUps(() => search())).toEqual([4]);
  });

  it('keeps reporting after a detach and re-attach', async () => {
    grids[0].grid.matches = 3;
    view.remove();
    document.body.append(view);
    await view.updateComplete;

    expect(await rollUps(() => search())).toEqual([3]);
  });

  it('drops the search when a grid reshapes', async () => {
    grids.forEach((grid) => (grid.grid.matches = 1));
    await rollUps(() => search());

    const totals = await rollUps(() =>
      grids[2].dispatchEvent(new CustomEvent('grid-reshape', { detail: null, bubbles: true })),
    );

    expect(totals).toEqual([0]);
    expect(grids.map((grid) => grid.grid.cleared)).toEqual([1, 1, 1]);
  });

  it('drops the search when a section collapses or expands', async () => {
    grids.forEach((grid) => (grid.grid.matches = 1));
    await rollUps(() => search());
    expect(await rollUps(() => collapse(1))).toEqual([0]);

    await rollUps(() => search());
    expect(await rollUps(() => collapse(1))).toEqual([0]);
  });
});
