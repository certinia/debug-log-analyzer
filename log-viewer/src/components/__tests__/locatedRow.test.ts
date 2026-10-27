/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import { frameLines, indexOf, rawStoreOf } from '#test-helpers/apexLog.js';
import { ROOT_PATH_ID } from '../../core/log/keyPathIds.js';
import { LocatedRowIds, rowDetailSelection, type RowReader } from '../locatedRow.js';

type Row = Record<string, unknown>;
const parents = new WeakMap<Row, Row>();
/** The rows are their own data, with the parent each was built under. */
const read: RowReader<Row> = { data: (row) => row, parentOf: (row) => parents.get(row) };

function treeRow(data: Row, parent?: Row): Row {
  if (parent) {
    parents.set(data, parent);
  }
  return data;
}

/** exec -> m1 -> soql, as frames of a parsed log. */
async function chain() {
  const { log, store } = await rawStoreOf(
    frameLines([
      { text: 'exec', children: [{ text: 'm1', children: [{ text: 'soql', self: 10 }] }] },
    ]),
  );
  return {
    store,
    exec: indexOf(log, 'exec'),
    m1: indexOf(log, 'm1'),
    soql: indexOf(log, 'soql'),
  };
}

describe('rowDetailSelection', () => {
  /** The bucket and caller rows a bottom-up grid leaves: the bucket holds the
   *  occurrences, the caller row derives its own. */
  async function rows() {
    const { store, m1, soql } = await chain();
    const paths = store.keyPathIds();
    const bucketPath = paths.step(ROOT_PATH_ID, paths.keyIdOf(soql));
    const bucket = treeRow({
      key: 'soql',
      _pathId: bucketPath,
      instances: [soql],
      eventIndex: soql,
      text: 'soql',
    });
    const caller = treeRow(
      {
        key: 'm1',
        _pathId: paths.step(bucketPath, paths.keyIdOf(m1)),
        eventIndex: soql,
        text: 'm1',
      },
      bucket,
    );
    return { store, bucket, caller, m1, soql };
  }

  // Its locals are the caller's, a level above the calls its totals count.
  it('names the frames a bottom-up caller row is, beside the calls it counts', async () => {
    const { store, caller, m1, soql } = await rows();

    expect(rowDetailSelection(caller, read, store, 'callers')).toEqual({
      kind: 'aggregate',
      instances: [soql],
      frames: [m1],
      calledBy: 'm1',
    });
  });

  it('gives a root bucket its own calls, as it stands at their depth', async () => {
    const { store, bucket, soql } = await rows();

    expect(rowDetailSelection(bucket, read, store, 'callers')).toEqual({
      kind: 'aggregate',
      instances: [soql],
      frames: [soql],
      calledBy: undefined,
    });
  });

  it('gives a top-down row its own calls, as it sits at their depth', async () => {
    const { store, caller, soql } = await rows();

    expect(rowDetailSelection(caller, read, store, 'callees')).toMatchObject({
      instances: [soql],
      frames: [soql],
    });
  });

  it('names the one call a Time Order row is', () => {
    const row = treeRow({ eventIndex: 5 });

    expect(rowDetailSelection(row, read, null, 'callees')).toEqual({
      kind: 'event',
      eventIndex: 5,
    });
  });
});

describe('LocatedRowIds', () => {
  it('builds the paths of the rows the frames stand for', async () => {
    const { store, m1: outer, soql: inner } = await chain();
    const paths = store.keyPathIds();
    // The row the frame is, and a row for it under another bucket.
    const own = paths.step(ROOT_PATH_ID, paths.keyIdOf(inner));
    const under = paths.step(paths.step(ROOT_PATH_ID, paths.keyId('other')), paths.keyIdOf(inner));
    // The row of the caller above it, which stands for the caller.
    paths.step(own, paths.keyIdOf(outer));

    expect(new LocatedRowIds().idsFor(store, [inner], 'callers').slice().sort()).toEqual(
      [own, under].sort(),
    );
  });

  it('reuses what it built for the frames it was last asked about', async () => {
    const { store, soql } = await chain();
    // The view re-reports its picked frames whenever the pointer leaves a row.
    const memo = new LocatedRowIds();
    const picked = [soql];

    expect(memo.idsFor(store, picked, 'callers')).toBe(memo.idsFor(store, picked, 'callers'));
  });

  it('rebuilds for the same frames in the other direction', async () => {
    const { store, soql } = await chain();
    const memo = new LocatedRowIds();
    const picked = [soql];

    expect(memo.idsFor(store, picked, 'callers')).not.toEqual(
      memo.idsFor(store, picked, 'callees'),
    );
  });

  it('names the rows of a view keyed by event with the indexes themselves', async () => {
    const { store, soql } = await chain();
    const picked = [soql];

    expect(new LocatedRowIds().idsFor(store, picked, undefined)).toBe(picked);
  });
});
