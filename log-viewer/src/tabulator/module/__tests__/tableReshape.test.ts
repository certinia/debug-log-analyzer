/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { SorterFromTable, Tabulator } from 'tabulator-tables';

import { onTableReshaped } from '../tableReshape.js';

function setup() {
  const handlers = new Map<string, (payload: SorterFromTable[]) => void>();
  const table = {
    on: (event: string, handler: (payload: SorterFromTable[]) => void) => {
      handlers.set(event, handler);
    },
  } as unknown as Tabulator;
  const changed = jest.fn();
  onTableReshaped(table, changed);
  return {
    changed,
    events: [...handlers.keys()],
    sorted: (...sorters: Array<[string, string]>) =>
      handlers.get('dataSorting')?.(
        sorters.map(([field, dir]) => ({ field, dir }) as SorterFromTable),
      ),
    columnsChanged: () => handlers.get('columnVisibilityChanged')?.([]),
  };
}

describe('onTableReshaped', () => {
  it('reports an order the table did not have before', () => {
    const { changed, sorted } = setup();

    sorted(['selfTime', 'desc']);
    expect(changed).toHaveBeenCalledTimes(1);

    sorted(['selfTime', 'asc']);
    sorted(['name', 'asc']);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('stays quiet where the order is the one already in force', () => {
    const { changed, sorted } = setup();
    sorted(['selfTime', 'desc']);

    // What expanding a tree row does: each opened subtree is ordered through the
    // same call, so the event repeats the order the table has.
    sorted(['selfTime', 'desc']);
    sorted(['selfTime', 'desc']);

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('tells a second sort column from the first alone', () => {
    const { changed, sorted } = setup();
    sorted(['selfTime', 'desc']);

    sorted(['selfTime', 'desc'], ['name', 'asc']);

    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('reports a column going on or off show, which the matches are counted over', () => {
    const { changed, columnsChanged } = setup();

    columnsChanged();

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('reads the sort as it starts, so no row component is built to report it', () => {
    // A dataSorted subscriber makes Tabulator build a component per sorted row.
    expect(setup().events).toEqual(['dataSorting', 'columnVisibilityChanged']);
  });
});
