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
  rowFrames,
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

function ev(text: string, parent: LogEvent | null, eventIndex?: number): LogEvent {
  return { type: 'METHOD_ENTRY', namespace: '', text, parent, eventIndex } as unknown as LogEvent;
}

/** A table host holding a rendered row element per index, as the stamp leaves
 *  them, inside the holder and spacer element Tabulator mounts. */
function host(...indexes: number[]): HTMLElement {
  const element = document.createElement('div');
  const holder = document.createElement('div');
  holder.classList.add('tabulator-tableholder');
  const spacers = document.createElement('div');
  spacers.classList.add('tabulator-table');
  // The renderer always writes both spacers, so start where a rendered table is.
  spacers.style.paddingTop = '0px';
  spacers.style.paddingBottom = '0px';
  holder.append(spacers);
  element.append(holder);
  for (const index of indexes) {
    const row = document.createElement('div');
    row.classList.add('tabulator-row');
    stamp(rowComponent(row, { eventIndex: index }));
    spacers.append(row);
  }
  return element;
}

/**
 * Re-attaches a row the renderer had detached, which is what a scroll or a sort
 * does with a row it has already built. Awaits the observer, which reports after
 * the arrival.
 */
async function reattach(container: HTMLElement, row: HTMLElement): Promise<void> {
  container.querySelector('.tabulator-table')!.append(row);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function rowFor(container: HTMLElement, index: number): HTMLElement {
  return container.querySelectorAll<HTMLElement>('.tabulator-row')[index]!;
}

/** A row entering an already-mounted table, which is what the renderer does the
 *  first time one is scrolled to: in the DOM first, stamped as it initialises. */
function renderRow(container: HTMLElement, index: number): HTMLElement {
  const row = document.createElement('div');
  row.classList.add('tabulator-row');
  container.querySelector('.tabulator-table')!.append(row);
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

  it('un-lights a row the renderer had detached when the mark moved', () => {
    // The formatter does not run again for a row the renderer only re-attaches,
    // so a class left on a detached element comes back with it.
    const container = host();
    const marker = new LocatedRowMarker();
    marker.mark(container, [4]);
    const row = renderRow(container, 4);

    row.remove();
    marker.mark(container, [5]);
    container.querySelector('.tabulator-table')!.append(row);

    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);
  });

  it('marks a row the renderer had detached before the mark named it', async () => {
    // Rendered once, so it will not be stamped again, then scrolled out of view:
    // the renderer keeps the element and detaches it.
    const container = host();
    const row = renderRow(container, 4);
    row.remove();

    // Only now does the mark name it, so neither half can reach it.
    const marker = new LocatedRowMarker();
    marker.mark(container, [4]);
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);

    // Coming back is what re-reads the mark, whatever moved the window: this
    // holds for a sort at the top of a table, which writes no spacer at all.
    await reattach(container, row);

    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('keeps watching a table rebuilt into the same container', async () => {
    // Several views destroy the table and build another in the same element, so
    // a watch held against the old one would go quiet for good.
    const container = host();
    const marker = new LocatedRowMarker();
    marker.mark(container, [4]);
    container.querySelector('.tabulator-tableholder')!.remove();
    const rebuilt = host(4);
    container.append(rebuilt.querySelector('.tabulator-tableholder')!);

    marker.mark(container, [4]);
    const row = renderRow(container, 9);
    row.remove();
    marker.mark(container, [9]);
    await reattach(container, row);

    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('leaves a row alone where nothing has marked its table', () => {
    const row = renderRow(host(), 4);

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

describe('rowFrames', () => {
  /** exec -> m1 -> soql, with the indexes the log answers about. */
  function log() {
    const exec = ev('exec', null, 1);
    const m1 = ev('m1', exec, 3);
    const soql = ev('soql', m1, 5);
    return {
      soql,
      apexLog: { eventsById: { 1: exec, 3: m1, 5: soql } } as unknown as ApexLog,
    };
  }

  /** The bucket for `soql` and the caller row under it, as a bottom-up grid
   *  leaves them: the bucket holds the occurrences, the caller row derives its. */
  function rows(apexLog: ApexLog, soql: LogEvent) {
    const paths = logStoreFor(apexLog).keyPathIds();
    const bucketPath = paths.step(ROOT_PATH_ID, paths.keyIdOf(soql));
    const bucket = rowComponent(document.createElement('div'), {
      key: 'soql',
      _pathId: bucketPath,
      instances: [soql],
    });
    const caller = rowComponent(
      document.createElement('div'),
      { key: 'm1', _pathId: paths.step(bucketPath, paths.keyIdOf(soql.parent!)) },
      bucket,
    );
    return { bucket, caller };
  }

  it('names the caller a bottom-up row is, not the calls it counts', () => {
    const { apexLog, soql } = log();
    const { caller } = rows(apexLog, soql);

    expect(rowFrames(caller, apexLog, 'callers')).toEqual([3]);
  });

  it('leaves a top-down row as the calls it counts, since it sits at their depth', () => {
    const { apexLog, soql } = log();
    const { caller } = rows(apexLog, soql);

    expect(rowFrames(caller, apexLog, 'callees')).toEqual([5]);
  });

  it('names its own occurrences for the row a bottom-up tree is seeded from', () => {
    const { apexLog, soql } = log();
    const { bucket } = rows(apexLog, soql);

    expect(rowFrames(bucket, apexLog, 'callers')).toEqual([5]);
  });
});

describe('LocatedRowIds', () => {
  const root = ev('exec', null);
  const outerFrame = ev('outer', root);
  const frame = ev('inner', outerFrame);
  const log = { eventsById: { 5: frame } } as unknown as ApexLog;

  it('builds the paths of the rows the frames stand for', () => {
    const paths = logStoreFor(log).keyPathIds();
    // The row the frame is, and a row for it under another bucket.
    const own = paths.step(ROOT_PATH_ID, paths.keyIdOf(frame));
    const under = paths.step(paths.step(ROOT_PATH_ID, paths.keyId('other')), paths.keyIdOf(frame));
    // The row of the caller above it, which stands for the caller.
    paths.step(own, paths.keyIdOf(outerFrame));

    expect(new LocatedRowIds().idsFor(log, [5], 'callers').slice().sort()).toEqual(
      [own, under].sort(),
    );
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
