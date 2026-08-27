/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { RowComponent } from 'tabulator-tables';

import type { ApexLog, LogEvent } from 'apex-log-parser';

import { logStoreFor, type LogStore } from '../../core/log/LogStore.js';
import { ROOT_PATH_ID, KeyPathIds } from '../../core/log/keyPathIds.js';
import {
  LOCATED_ROW_CLASS,
  LocatedRowIds,
  LocatedRowMarker,
  eventPathIds,
  rowIndexStamper,
  rowPathId,
  rowPathStamper,
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

/** A bucket row and its chain of parents, innermost last, as tabulator hands them
 *  over: the tree parent of a bottom-up caller row is the frame it called. */
function bucketRow(...keys: string[]): RowComponent {
  let row: RowComponent | false = false;
  for (const key of keys) {
    row = rowComponent(document.createElement('div'), { key }, row);
  }
  return row as RowComponent;
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

describe('rowPathStamper', () => {
  it('marks the row under one parent and not its namesake under another', () => {
    const ids = new KeyPathIds();
    const stampPath = rowPathStamper(ids);
    const container = document.createElement('div');
    const rows = [bucketRow('Trigger1', 'Util.log'), bucketRow('Trigger2', 'Util.log')];
    for (const row of rows) {
      const element = row.getElement();
      element.classList.add('tabulator-row');
      stampPath(row);
      container.append(element);
    }
    const marker = new LocatedRowMarker();

    marker.mark(container, [rowPathId(rows[0]!, ids)!]);

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
  let ids: KeyPathIds;
  beforeEach(() => {
    ids = new KeyPathIds();
  });

  it('names a top-level row by its own key alone', () => {
    expect(rowPathId(bucketRow('A'), ids)).toBe(ids.pathId(ROOT_PATH_ID, 'A'));
  });

  it('tells two same-named rows apart by the parents that reach them', () => {
    // One method holds a row under every caller it has, so the key alone cannot.
    expect(rowPathId(bucketRow('Trigger1', 'Util.log'), ids)).not.toBe(
      rowPathId(bucketRow('Trigger2', 'Util.log'), ids),
    );
  });

  it('gives one id to the whole path, so two rows on it agree', () => {
    const deep = rowPathId(bucketRow('A', 'B', 'C'), ids);
    expect(deep).toBe(rowPathId(bucketRow('A', 'B', 'C'), ids));
    expect(deep).not.toBe(rowPathId(bucketRow('A', 'B'), ids));
  });

  it('leaves a row that stands for one frame unnamed, as its index names it', () => {
    expect(rowPathId(rowComponent(document.createElement('div'), { id: 7 }), ids)).toBeUndefined();
  });
});

describe('eventPathIds', () => {
  const root = ev('exec', null);
  const outer = ev('outer', root);
  const inner = ev('inner', outer);
  let store: LogStore;
  let ids: KeyPathIds;
  beforeEach(() => {
    // A store per test, since each expects an empty table. The frames are not in
    // this log's index, so the ids are minted rather than read from the cache.
    store = logStoreFor({ eventsById: [] } as unknown as ApexLog);
    ids = store.keyPathIds();
  });

  it('names one row in a top-down view, at the depth the frame ran at', () => {
    const found = eventPathIds(inner, 'callees', store);

    expect(found).toHaveLength(1);
    expect(found[0]).toBe(rowPathId(bucketRow('METHOD_ENTRY||outer', 'METHOD_ENTRY||inner'), ids));
  });

  it('names a row per caller depth in a bottom-up view', () => {
    // The frame heads a row on its own, and one under each caller above it.
    const found = eventPathIds(inner, 'callers', store);

    expect(found).toEqual([
      rowPathId(bucketRow('METHOD_ENTRY||inner'), ids),
      rowPathId(bucketRow('METHOD_ENTRY||inner', 'METHOD_ENTRY||outer'), ids),
    ]);
  });

  it('leaves the log root out, as it is a row in neither view', () => {
    expect(eventPathIds(root, 'callers', store)).toEqual([]);
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
    expect(found).toEqual(eventPathIds(frame, 'callers', logStoreFor(log)));
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
