/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { LogEvent } from 'apex-log-parser';

import { KeyPathIds, ROOT_PATH_ID } from '../keyPathIds.js';

/** A frame at `eventIndex`, of the type and text a bucket key is built from. */
function ev(eventIndex: number, text: string, parent: LogEvent | null, type = 'METHOD_ENTRY') {
  return { eventIndex, type, namespace: '', text, parent } as unknown as LogEvent;
}

describe('KeyPathIds', () => {
  let ids: KeyPathIds;
  beforeEach(() => {
    ids = new KeyPathIds(32);
  });

  /** Interns a whole path, named outermost key first as a row reads, the way a
   *  tree build composes one. */
  function pathFor(table: KeyPathIds, ...keys: string[]): number {
    let id = ROOT_PATH_ID;
    for (const key of keys) {
      id = table.step(id, table.keyId(key));
    }
    return id;
  }

  it('gives one id to the same path, however often it is asked for', () => {
    expect(pathFor(ids, 'A', 'B')).toBe(pathFor(ids, 'A', 'B'));
  });

  it('tells the same key apart under different parents', () => {
    // The reason a key alone cannot name a row: a bucket map is allocated per
    // parent, so one method holds a row under every caller it has.
    expect(pathFor(ids, 'Trigger1', 'Util.log')).not.toBe(pathFor(ids, 'Trigger2', 'Util.log'));
  });

  it('tells a path apart from the prefix it extends', () => {
    expect(pathFor(ids, 'A', 'B')).not.toBe(pathFor(ids, 'A'));
  });

  it('reads a path back, outermost first', () => {
    expect(ids.keysOf(pathFor(ids, 'A', 'B', 'C'))).toEqual(['A', 'B', 'C']);
  });

  it('reads the empty path as no keys, since no row stands for it', () => {
    expect(ids.keysOf(ROOT_PATH_ID)).toEqual([]);
  });

  it('reports a path as running through itself and through every prefix', () => {
    const inner = pathFor(ids, 'A', 'B', 'C');

    expect(ids.reaches(inner, inner)).toBe(true);
    expect(ids.reaches(inner, pathFor(ids, 'A'))).toBe(true);
    expect(ids.reaches(inner, pathFor(ids, 'A', 'B'))).toBe(true);
    // The other way round, and a path off to the side, both miss.
    expect(ids.reaches(pathFor(ids, 'A'), inner)).toBe(false);
    expect(ids.reaches(inner, pathFor(ids, 'Z'))).toBe(false);
  });

  it('reads back how many keys a path stands for, and none for the empty one', () => {
    expect(ids.depthOf(pathFor(ids, 'A', 'B', 'C'))).toBe(3);
    expect(ids.depthOf(ROOT_PATH_ID)).toBe(0);
  });

  it('mints on its own, so an id from one log means nothing to another', () => {
    const other = new KeyPathIds(32);

    expect(pathFor(other, 'Z')).toBe(pathFor(ids, 'A'));
    expect(other.keysOf(pathFor(other, 'Z'))).toEqual(['Z']);
    expect(ids.keysOf(pathFor(ids, 'A'))).toEqual(['A']);
  });

  describe('keyIdOf', () => {
    it('keeps one id per signature, not one per frame', () => {
      const first = ev(1, 'Util.log', null);
      const second = ev(2, 'Util.log', null);

      expect(ids.keyIdOf(first)).toBe(ids.keyIdOf(first));
      // Same type, namespace and text is the same bucket.
      expect(ids.keyIdOf(second)).toBe(ids.keyIdOf(first));
    });

    it('keys a frame no slot of its own covers, without one standing in for another', () => {
      // Built rather than parsed, so neither carries an index at all. Keeping one
      // under an index-less write lands it on the memo as an ordinary property,
      // which the next such frame then reads back as its own.
      const loose = { type: 'METHOD_ENTRY', namespace: '', text: 'made up' } as unknown as LogEvent;
      const other = {
        type: 'METHOD_ENTRY',
        namespace: '',
        text: 'and another',
      } as unknown as LogEvent;

      expect(ids.keyIdOf(loose)).toBe(ids.keyIdOf(loose));
      expect(ids.keyIdOf(other)).not.toBe(ids.keyIdOf(loose));
      // And one whose index is past the end of the log's own array.
      expect(ids.keyIdOf(ev(9999, 'past the end', null))).not.toBe(ids.keyIdOf(loose));
    });
  });

  describe('stackIdOf', () => {
    it('reads through the entry type, which a bucket key does not', () => {
      const unit = ev(1, 'Thing.run()', null, 'CODE_UNIT_STARTED');
      const method = ev(2, 'Thing.run()', null, 'METHOD_ENTRY');

      // A method that recurses as a code unit is one frame to the stack.
      expect(ids.stackIdOf(unit)).toBe(ids.stackIdOf(method));
      expect(ids.keyIdOf(unit)).not.toBe(ids.keyIdOf(method));
    });

    it('tells two frames apart', () => {
      expect(ids.stackIdOf(ev(1, 'one', null))).not.toBe(ids.stackIdOf(ev(2, 'two', null)));
    });
  });

  describe('pathIdsOf', () => {
    const root = ev(1, 'exec', null);
    const outer = ev(2, 'outer', root);
    const inner = ev(3, 'inner', outer);

    /** The ids the walk adds, in the order it adds them. */
    function found(event: LogEvent, direction: 'callers' | 'callees'): number[] {
      const into = new Set<number>();
      ids.pathIdsOf(event, direction, into);
      return [...into];
    }

    it('names one row in a top-down view, at the depth the frame ran at', () => {
      expect(found(inner, 'callees')).toEqual([
        pathFor(ids, 'METHOD_ENTRY||outer', 'METHOD_ENTRY||inner'),
      ]);
    });

    it('names a row per caller depth in a bottom-up view', () => {
      // The frame heads a row on its own, and one under each caller above it.
      expect(found(inner, 'callers')).toEqual([
        pathFor(ids, 'METHOD_ENTRY||inner'),
        pathFor(ids, 'METHOD_ENTRY||inner', 'METHOD_ENTRY||outer'),
      ]);
    });

    it('leaves the log root out, as it heads a row in neither view', () => {
      expect(found(root, 'callers')).toEqual([]);
    });
  });
});
