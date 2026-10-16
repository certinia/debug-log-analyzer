/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { callFrame } from '#test-helpers/events.js';
import { logStoreFor } from '../../core/log/LogStore.js';
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
    const bucket = treeRow({
      key: 'soql',
      _pathId: bucketPath,
      instances: [soql],
      originalData: soql,
      text: 'soql',
    });
    const caller = treeRow(
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

    expect(rowDetailSelection(caller, read, apexLog, 'callers')).toEqual({
      kind: 'aggregate',
      instances: [5],
      frames: [3],
      calledBy: 'm1',
    });
  });

  it('gives a root bucket its own calls, as it stands at their depth', () => {
    const { apexLog, bucket } = rows();

    expect(rowDetailSelection(bucket, read, apexLog, 'callers')).toEqual({
      kind: 'aggregate',
      instances: [5],
      frames: [5],
      calledBy: undefined,
    });
  });

  it('gives a top-down row its own calls, as it sits at their depth', () => {
    const { apexLog, caller } = rows();

    expect(rowDetailSelection(caller, read, apexLog, 'callees')).toMatchObject({
      instances: [5],
      frames: [5],
    });
  });

  it('names the one call a Time Order row is', () => {
    const soql = callFrame('soql', null, 5);
    const row = treeRow({ originalData: soql });

    expect(rowDetailSelection(row, read, null, 'callees')).toEqual({
      kind: 'event',
      eventIndex: 5,
    });
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
