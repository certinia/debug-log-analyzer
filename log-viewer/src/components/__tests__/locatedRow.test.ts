/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import type { RowComponent } from 'tabulator-tables';

import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import { callFrame } from '#test-helpers/events.js';
import { logStoreFor } from '../../core/log/LogStore.js';
import { KeyPathIds, ROOT_PATH_ID } from '../../core/log/keyPathIds.js';
import {
  LocatedRowIds,
  rowDetailSelection,
  rowFrames,
  rowPathId,
  stampRowPath,
} from '../locatedRow.js';

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

describe('stampRowPath', () => {
  it('stamps a row apart from its namesake under another parent', () => {
    const ids = new KeyPathIds(0);
    const rows = [bucketRow(ids, 'Trigger1', 'Util.log'), bucketRow(ids, 'Trigger2', 'Util.log')];

    rows.forEach(stampRowPath);

    const stamps = rows.map((row) => row.getElement().getAttribute('data-row-index'));
    expect(stamps[0]).not.toBeNull();
    expect(stamps[0]).not.toBe(stamps[1]);
  });
});

describe('rowPathId', () => {
  it('leaves a row that stands for one frame unnamed, as its index names it', () => {
    expect(rowPathId(rowComponent(document.createElement('div'), { id: 7 }))).toBeUndefined();
  });
});

describe('rowFrames', () => {
  /** exec -> m1 -> soql, with the indexes the log answers about. */
  function log() {
    const exec = callFrame('exec', null, 1);
    const m1 = callFrame('m1', exec, 3);
    const soql = callFrame('soql', m1, 5);
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

describe('rowDetailSelection', () => {
  /** exec -> m1 -> soql, with the bucket and caller rows a bottom-up grid
   *  leaves: the bucket holds the occurrences, the caller row derives its own. */
  function rows() {
    const exec = callFrame('exec', null, 1);
    const m1 = callFrame('m1', exec, 3);
    const soql = callFrame('soql', m1, 5);
    const apexLog = { eventsById: { 1: exec, 3: m1, 5: soql } } as unknown as ApexLog;
    const paths = logStoreFor(apexLog).keyPathIds();
    const bucketPath = paths.step(ROOT_PATH_ID, paths.keyIdOf(soql));
    const bucket = rowComponent(document.createElement('div'), {
      key: 'soql',
      _pathId: bucketPath,
      instances: [soql],
      originalData: soql,
      text: 'soql',
    });
    const caller = rowComponent(
      document.createElement('div'),
      {
        key: 'm1',
        _pathId: paths.step(bucketPath, paths.keyIdOf(m1)),
        originalData: soql,
        text: 'm1',
      },
      bucket,
    );
    return { apexLog, bucket, caller };
  }

  // Its locals are the caller's, a level above the calls its totals count.
  it('names the frames a bottom-up caller row is, beside the calls it counts', () => {
    const { apexLog, caller } = rows();

    expect(rowDetailSelection(caller, apexLog, 'callers')).toEqual({
      kind: 'aggregate',
      instances: [5],
      frames: [3],
      calledBy: 'm1',
    });
  });

  it('gives a root bucket its own calls, as it stands at their depth', () => {
    const { apexLog, bucket } = rows();

    expect(rowDetailSelection(bucket, apexLog, 'callers')).toEqual({
      kind: 'aggregate',
      instances: [5],
      frames: [5],
      calledBy: undefined,
    });
  });

  it('gives a top-down row its own calls, as it sits at their depth', () => {
    const { apexLog, caller } = rows();

    expect(rowDetailSelection(caller, apexLog, 'callees')).toMatchObject({
      instances: [5],
      frames: [5],
    });
  });

  it('names the one call a Time Order row is', () => {
    const soql = callFrame('soql', null, 5);
    const row = rowComponent(document.createElement('div'), { originalData: soql });

    expect(rowDetailSelection(row, null, 'callees')).toEqual({ kind: 'event', eventIndex: 5 });
  });
});

describe('LocatedRowIds', () => {
  const root = callFrame('exec', null);
  const outerFrame = callFrame('outer', root);
  const frame = callFrame('inner', outerFrame);
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
