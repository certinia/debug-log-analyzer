/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import type { RowComponent } from 'tabulator-tables';

import type { ApexLog, LogEvent } from 'apex-log-parser';

import { logStoreFor } from '../../core/log/LogStore.js';
import { KeyPathIds, ROOT_PATH_ID } from '../../core/log/keyPathIds.js';
import {
  LOCATED_ROW_CLASS,
  LocatedRowIds,
  LocatedRowMarker,
  rowIndexStamper,
  rowPathId,
  stampRowPath,
} from '../locatedRow.js';

const stamp = rowIndexStamper('eventIndex');

function rowComponent(
  element: HTMLElement,
  data: Record<string, unknown>,
  parent: RowComponent | false = false,
): RowComponent {
  return {
    getElement: () => element,
    getData: () => data,
    getTreeParent: () => parent,
  } as unknown as RowComponent;
}

/** A bucket row as its builder leaves it: the key it merges, and the path that
 *  tells it from a same-named row under another caller. */
function bucketRow(ids: KeyPathIds, ...keys: string[]): RowComponent {
  let pathId = ROOT_PATH_ID;
  for (const key of keys) {
    pathId = ids.step(pathId, ids.keyId(key));
  }
  return rowComponent(document.createElement('div'), {
    key: keys[keys.length - 1],
    _pathId: pathId,
  });
}

function ev(text: string, parent: LogEvent | null): LogEvent {
  return { type: 'METHOD_ENTRY', namespace: '', text, parent } as unknown as LogEvent;
}

/** A table host holding a rendered row element per index, as the stamp leaves them. */
function host(...indexes: number[]): HTMLElement {
  const element = document.createElement('div');
  for (const index of indexes) {
    const row = document.createElement('div');
    row.classList.add('tabulator-row');
    stamp(rowComponent(row, { eventIndex: index }));
    element.append(row);
  }
  return element;
}

function rowFor(container: HTMLElement, index: number): HTMLElement {
  return container.children[index] as HTMLElement;
}

/** A row entering an already-mounted table, which is what the renderer does the
 *  first time one is scrolled to: in the DOM first, stamped as it initialises. */
function renderRow(container: HTMLElement, index: number): HTMLElement {
  const row = document.createElement('div');
  row.classList.add('tabulator-row');
  container.append(row);
  stamp(rowComponent(row, { eventIndex: index }));
  return row;
}

describe('stampRowPath', () => {
  it('marks the row under one parent and not its namesake under another', () => {
    const ids = new KeyPathIds(0);
    const container = document.createElement('div');
    const rows = [bucketRow(ids, 'Trigger1', 'Util.log'), bucketRow(ids, 'Trigger2', 'Util.log')];
    for (const row of rows) {
      const element = row.getElement();
      element.classList.add('tabulator-row');
      stampRowPath(row);
      container.append(element);
    }
    const marker = new LocatedRowMarker();

    marker.mark(container, [rowPathId(rows[0]!)!]);

    expect(rows[0]!.getElement().classList.contains(LOCATED_ROW_CLASS)).toBe(true);
    expect(rows[1]!.getElement().classList.contains(LOCATED_ROW_CLASS)).toBe(false);
  });
});

describe('rowIndexStamper', () => {
  it('leaves a row with no index alone, as a calc row is', () => {
    const element = document.createElement('div');

    stamp(rowComponent(element, { 'duration.total': 12 }));

    expect(element.attributes).toHaveLength(0);
  });
});

describe('rowPathId', () => {
  it('leaves a row that stands for one frame unnamed, as its index names it', () => {
    expect(rowPathId(rowComponent(document.createElement('div'), { id: 7 }))).toBeUndefined();
  });
});

describe('LocatedRowMarker', () => {
  it('marks the rendered row for the event', () => {
    const container = host(1, 2);
    const marker = new LocatedRowMarker();

    marker.mark(container, [2]);

    expect(rowFor(container, 1).classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('marks every occurrence a merged row stands for', () => {
    const container = host(1, 2, 3);
    const marker = new LocatedRowMarker();

    marker.mark(container, [1, 3]);

    expect(rowFor(container, 0).classList.contains(LOCATED_ROW_CLASS)).toBe(true);
    expect(rowFor(container, 1).classList.contains(LOCATED_ROW_CLASS)).toBe(false);
    expect(rowFor(container, 2).classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('moves the mark, leaving nothing behind on the rows it left', () => {
    const container = host(1, 2);
    const marker = new LocatedRowMarker();

    marker.mark(container, [1]);
    marker.mark(container, [2]);

    expect(rowFor(container, 0).classList.contains(LOCATED_ROW_CLASS)).toBe(false);
    expect(rowFor(container, 1).classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('drops the mark on an empty list, on clear, and when there is no host', () => {
    const container = host(1);
    const row = rowFor(container, 0);
    const marker = new LocatedRowMarker();

    marker.mark(container, [1]);
    marker.mark(container, []);
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);

    marker.mark(container, [1]);
    marker.clear();
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);

    marker.mark(container, [1]);
    marker.mark(null, [1]);
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);
  });

  it('lights a row that arrives after the mark, as scrolling to a new one does', () => {
    const container = host();
    new LocatedRowMarker().mark(container, [4]);

    // The sweep found no rows, so this is the row lighting itself.
    expect(renderRow(container, 4).classList.contains(LOCATED_ROW_CLASS)).toBe(true);
    expect(renderRow(container, 5).classList.contains(LOCATED_ROW_CLASS)).toBe(false);
  });

  it('un-lights a row the renderer hands back with the class still on it', () => {
    const container = host();
    const marker = new LocatedRowMarker();
    marker.mark(container, [4]);
    const row = renderRow(container, 4);

    marker.mark(container, [5]);
    // Re-used rather than rebuilt, so it arrives carrying the old mark.
    row.classList.add(LOCATED_ROW_CLASS);
    stamp(rowComponent(row, { eventIndex: 4 }));

    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);
  });

  it('leaves a row alone where nothing has marked its table', () => {
    const row = renderRow(document.createElement('div'), 4);

    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);
  });

  it('stops lighting rows of a table the mark has left', () => {
    const first = host();
    const second = host();
    const marker = new LocatedRowMarker();

    marker.mark(first, [4]);
    marker.mark(second, [4]);

    expect(renderRow(first, 4).classList.contains(LOCATED_ROW_CLASS)).toBe(false);
    expect(renderRow(second, 4).classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('leaves a row the table has not rendered alone', () => {
    const container = host(1);
    const marker = new LocatedRowMarker();

    marker.mark(container, [7]);

    expect(rowFor(container, 0).classList.contains(LOCATED_ROW_CLASS)).toBe(false);
  });
});

describe('LocatedRowIds', () => {
  const root = ev('exec', null);
  const outerFrame = ev('outer', root);
  const frame = ev('inner', outerFrame);
  const log = { eventsById: { 5: frame } } as unknown as ApexLog;

  it('builds the paths of the rows the frames belong to', () => {
    const found = new LocatedRowIds().idsFor(log, [5], 'callers');

    // The log's own table, so a row stamped from it reaches the same ids.
    const expected = new Set<number>();
    logStoreFor(log).keyPathIds().pathIdsOf(frame, 'callers', expected);
    expect(found).toEqual([...expected]);
  });

  it('reuses what it built for the frames it was last asked about', () => {
    // The view re-reports its picked frames whenever the pointer leaves a row.
    const memo = new LocatedRowIds();
    const picked = [5];

    expect(memo.idsFor(log, picked, 'callers')).toBe(memo.idsFor(log, picked, 'callers'));
  });

  it('rebuilds for the same frames in the other direction', () => {
    const memo = new LocatedRowIds();
    const picked = [5];

    expect(memo.idsFor(log, picked, 'callers')).not.toEqual(memo.idsFor(log, picked, 'callees'));
  });

  it('names the rows of a view keyed by event with the indexes themselves', () => {
    const picked = [5];

    expect(new LocatedRowIds().idsFor(log, picked, undefined)).toBe(picked);
  });
});
