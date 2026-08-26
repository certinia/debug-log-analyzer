/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import type { RowComponent } from 'tabulator-tables';

import type { LogEvent } from 'apex-log-parser';

import {
  LOCATED_ROW_CLASS,
  LocatedRowMarker,
  eventKeyPaths,
  rowIndexStamper,
  rowKeyPath,
  stampRowKeyPath,
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

describe('stampRowKeyPath', () => {
  it('marks the row under one parent and not its namesake under another', () => {
    const container = document.createElement('div');
    const rows = [bucketRow('Trigger1', 'Util.log'), bucketRow('Trigger2', 'Util.log')];
    for (const row of rows) {
      const element = row.getElement();
      element.classList.add('tabulator-row');
      stampRowKeyPath(row);
      container.append(element);
    }
    const marker = new LocatedRowMarker();

    marker.mark(container, [rowKeyPath(rows[0]!)!]);

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

describe('rowKeyPath', () => {
  it('names a top-level row by its own key alone', () => {
    expect(rowKeyPath(bucketRow('A'))).toBe('A');
  });

  it('tells two same-named rows apart by the parents that reach them', () => {
    // One method holds a row under every caller it has, so the key alone cannot.
    expect(rowKeyPath(bucketRow('Trigger1', 'Util.log'))).not.toBe(
      rowKeyPath(bucketRow('Trigger2', 'Util.log')),
    );
  });

  it('reads a deep row as the whole path, outermost first', () => {
    const deep = rowKeyPath(bucketRow('A', 'B', 'C'));
    expect(deep).toBe(rowKeyPath(bucketRow('A', 'B', 'C')));
    expect(deep).not.toBe(rowKeyPath(bucketRow('A', 'B')));
  });

  it('leaves a row that stands for one frame unnamed, as its index names it', () => {
    expect(rowKeyPath(rowComponent(document.createElement('div'), { id: 7 }))).toBeUndefined();
  });
});

describe('eventKeyPaths', () => {
  const root = ev('exec', null);
  const outer = ev('outer', root);
  const inner = ev('inner', outer);

  it('names one row in a top-down view, at the depth the frame ran at', () => {
    const paths = eventKeyPaths(inner, 'callees');

    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe(rowKeyPath(bucketRow('METHOD_ENTRY||outer', 'METHOD_ENTRY||inner')));
  });

  it('names a row per caller depth in a bottom-up view', () => {
    // The frame heads a row on its own, and one under each caller above it.
    const paths = eventKeyPaths(inner, 'callers');

    expect(paths).toEqual([
      rowKeyPath(bucketRow('METHOD_ENTRY||inner')),
      rowKeyPath(bucketRow('METHOD_ENTRY||inner', 'METHOD_ENTRY||outer')),
    ]);
  });

  it('leaves the log root out, as it is a row in neither view', () => {
    expect(eventKeyPaths(root, 'callers')).toEqual([]);
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
