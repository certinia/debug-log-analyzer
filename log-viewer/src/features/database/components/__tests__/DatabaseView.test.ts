/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { LitElement } from 'lit';

import {
  eventBus,
  type DetailSelection,
  type DetailSource,
  type StatementType,
} from '../../../../core/events/EventBus.js';

// The three grids and the summary bring tabulator and its stylesheets with them;
// this suite only drives the selection contract between them and DatabaseView.
jest.mock('../DMLView.js', () => ({}));
jest.mock('../SOQLView.js', () => ({}));
jest.mock('../SOSLView.js', () => ({}));
jest.mock('../GovernorSummary.js', () => ({}));
jest.mock('../DatabaseSection.js', () => ({}));

import '../DatabaseView.js';
import { mountElement } from '../../../../__tests__/helpers/mount.js';

/** The slice of a grid DatabaseView drives, standing in for the real element. */
interface FakeGrid extends HTMLElement {
  deselects: number;
  owns: number | null;
  marked: readonly number[][];
}

/**
 * The grids render only once a log is loaded, so stand-ins are placed in the
 * shadow root the same way: one element per statement type, found by tag.
 */
function fakeGrid(tag: string, owns: number | null = null): FakeGrid {
  const grid = document.createElement(tag) as FakeGrid;
  grid.deselects = 0;
  grid.owns = owns;
  grid.marked = [];
  Object.assign(grid, {
    deselectRows: () => (grid.deselects += 1),
    selectByEventIndex: (eventIndex: number) => eventIndex === grid.owns,
    markLocated: (eventIndexes: readonly number[]) => {
      grid.marked = [...grid.marked, [...eventIndexes]];
    },
  });
  return grid;
}

describe('database-view selection', () => {
  let view: LitElement;
  let grids: Record<StatementType, FakeGrid>;
  let seen: Array<{ source: DetailSource; selection: DetailSelection | null }>;
  let off: () => void;

  beforeEach(async () => {
    view = await mountElement<LitElement>('database-view');
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

  it('says nothing for the select the inspector asked for', () => {
    // The revealed grid reports the selection it was just given.
    grids.soql.addEventListener('grid-selection', () => report('soql', 42));

    eventBus.emit('inspector:reveal', { source: 'database', eventIndex: 42 });

    expect(seen).toEqual([]);
    expect([grids.dml.deselects, grids.sosl.deselects]).toEqual([1, 1]);
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

describe('database-view find totals', () => {
  let view: LitElement;

  beforeEach(async () => {
    view = await mountElement<LitElement>('database-view');
  });

  /** The totals DatabaseView rolls up to the find widget while `run` happens. */
  function rollUps(run: () => void): number[] {
    const seen: number[] = [];
    const probe = (e: Event) =>
      void seen.push((e as CustomEvent<{ totalMatches: number }>).detail.totalMatches);
    document.addEventListener('lv-find-results', probe);
    run();
    document.removeEventListener('lv-find-results', probe);
    return seen;
  }

  const report = (type: StatementType, totalMatches: number) =>
    document.dispatchEvent(new CustomEvent('db-find-results', { detail: { totalMatches, type } }));

  /** Sections render in view order: DML, SOQL, SOSL. */
  const collapse = (index: number) =>
    view.shadowRoot
      ?.querySelectorAll('database-section')
      [index]?.dispatchEvent(new CustomEvent('section-toggle'));

  it('rolls a grid count up to the find widget', () => {
    expect(rollUps(() => report('soql', 3))).toEqual([3]);
  });

  it('drops a section count when the section collapses', async () => {
    report('soql', 3);

    // Collapsing removes the grid, so its matches can no longer be reached.
    const totals = rollUps(() => collapse(1));
    await view.updateComplete;

    expect(totals).toEqual([0]);
  });
});
