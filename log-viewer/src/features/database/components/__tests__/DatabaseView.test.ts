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

// The three grids and the summary bring tabulator and its stylesheets with them;
// this suite only drives the selection contract between them and DatabaseView.
jest.mock('../DMLView.js', () => ({}));
jest.mock('../SOQLView.js', () => ({}));
jest.mock('../SOSLView.js', () => ({}));
jest.mock('../GovernorSummary.js', () => ({}));
jest.mock('../DatabaseSection.js', () => ({}));
jest.mock('../../services/Database.js', () => ({ DatabaseAccess: {} }));

import '../DatabaseView.js';

/** The slice of a grid DatabaseView drives, standing in for the real element. */
interface FakeGrid extends HTMLElement {
  deselects: number;
  owns: number | null;
}

/**
 * The grids render only once a log is loaded, so stand-ins are placed in the
 * shadow root the same way: one element per statement type, found by tag.
 */
function fakeGrid(tag: string, owns: number | null = null): FakeGrid {
  const grid = document.createElement(tag) as FakeGrid;
  grid.deselects = 0;
  grid.owns = owns;
  Object.assign(grid, {
    deselectRows: () => (grid.deselects += 1),
    selectByEventIndex: (eventIndex: number) => eventIndex === grid.owns,
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
});
