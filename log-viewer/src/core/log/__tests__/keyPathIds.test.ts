/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { indexesOf, storeOf } from '#test-helpers/apexLog.js';

import { KeyPathIds, ROOT_PATH_ID } from '../keyPathIds.js';
import type { LogStore } from '../LogStore.js';
import { signaturesOf } from '../signatures.js';

const LOG =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1100)|METHOD_ENTRY|[2]|01p|ns.Inner.go()\n' +
  '09:18:22.6 (1200)|METHOD_EXIT|[2]|ns.Inner.go()\n' +
  '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n' +
  '09:18:22.6 (1400)|METHOD_ENTRY|[3]|01p|ns.Util.log()\n' +
  '09:18:22.6 (1500)|METHOD_EXIT|[3]|ns.Util.log()\n' +
  '09:18:22.6 (1600)|METHOD_ENTRY|[4]|01p|ns.Util.log()\n' +
  '09:18:22.6 (1700)|METHOD_EXIT|[4]|ns.Util.log()\n' +
  '09:18:22.6 (1800)|CODE_UNIT_STARTED|[EXTERNAL]|01q|ns.Thing.run()\n' +
  '09:18:22.6 (1900)|METHOD_ENTRY|[5]|01p|ns.Thing.run()\n' +
  '09:18:22.6 (2000)|METHOD_EXIT|[5]|ns.Thing.run()\n' +
  '09:18:22.6 (2100)|CODE_UNIT_FINISHED|ns.Thing.run()\n';

// The helper wraps the body in an execution and the `apex://pkg.Entry` code unit, whose namespace
// the methods under it take.
const EXECUTION = 'EXECUTION_STARTED|default|EXECUTION_STARTED';
const ENTRY = 'CODE_UNIT_STARTED|pkg|apex://pkg.Entry';

let store: LogStore;
beforeAll(async () => {
  ({ store } = await storeOf(LOG));
});

/** A table of its own, as each log has. */
function table(): KeyPathIds {
  return new KeyPathIds(signaturesOf(store.log), (id) => store.parentOf(id));
}

/** The one frame whose text is `text`, or the `nth` of several. */
function frame(text: string, nth = 0): number {
  return indexesOf(store.log, text)[nth]!;
}

/** Interns a whole path, named outermost key first as a row reads, the way a
 *  tree build composes one. */
function pathFor(paths: KeyPathIds, ...keys: string[]): number {
  let id = ROOT_PATH_ID;
  for (const key of keys) {
    id = paths.step(id, paths.keyId(key));
  }
  return id;
}

describe('KeyPathIds', () => {
  let ids: KeyPathIds;
  beforeEach(() => {
    ids = table();
  });

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
    const other = table();

    expect(pathFor(other, 'Z')).toBe(pathFor(ids, 'A'));
    expect(other.keysOf(pathFor(other, 'Z'))).toEqual(['Z']);
    expect(ids.keysOf(pathFor(ids, 'A'))).toEqual(['A']);
  });

  describe('chainNodeAt', () => {
    it('names the frame the row sits at, which is what a caller row stands for', () => {
      const inner = frame('ns.Inner.go()');
      const leafRow = pathFor(ids, 'METHOD_ENTRY|pkg|ns.Inner.go()');
      const callerRow = pathFor(
        ids,
        'METHOD_ENTRY|pkg|ns.Inner.go()',
        'METHOD_ENTRY|pkg|ns.Outer.run()',
      );

      expect(ids.chainNodeAt(inner, leafRow)).toBe(inner);
      expect(ids.chainNodeAt(inner, callerRow)).toBe(frame('ns.Outer.run()'));
    });

    it('answers for a path the chain misses with no frame', () => {
      const elsewhere = pathFor(ids, 'METHOD_ENTRY|pkg|Z');

      expect(ids.chainNodeAt(frame('ns.Inner.go()'), elsewhere)).toBe(0);
    });
  });

  describe('keyIdOf', () => {
    it('keeps one id per signature, not one per frame', () => {
      const first = frame('ns.Util.log()', 0);
      const second = frame('ns.Util.log()', 1);

      expect(ids.keyIdOf(first)).toBe(ids.keyIdOf(first));
      // Same type, namespace and text is the same bucket.
      expect(ids.keyIdOf(second)).toBe(ids.keyIdOf(first));
      expect(ids.keyText(ids.keyIdOf(first))).toBe('METHOD_ENTRY|pkg|ns.Util.log()');
    });

    it('names an event with no text by its type', () => {
      const execution = store.log.children[0]!.id;

      expect(ids.keyText(ids.keyIdOf(execution))).toBe(EXECUTION);
    });
  });

  describe('stackIdOf', () => {
    it('reads through the entry type, which a bucket key does not', () => {
      const unit = store.log.ofType('CODE_UNIT_STARTED').find((e) => e.text === 'ns.Thing.run()')!;
      const method = frame('ns.Thing.run()', 1);

      // A method that recurses as a code unit is one frame to the stack.
      expect(ids.stackIdOf(unit.id)).toBe(ids.stackIdOf(method));
      expect(ids.keyIdOf(unit.id)).not.toBe(ids.keyIdOf(method));
    });

    it('tells two frames apart', () => {
      expect(ids.stackIdOf(frame('ns.Outer.run()'))).not.toBe(
        ids.stackIdOf(frame('ns.Inner.go()')),
      );
    });
  });

  describe('pathIdOf', () => {
    it('names one row in a top-down view, at the depth the frame ran at', () => {
      expect(ids.keysOf(ids.pathIdOf(frame('ns.Inner.go()'))!)).toEqual([
        EXECUTION,
        ENTRY,
        'METHOD_ENTRY|pkg|ns.Outer.run()',
        'METHOD_ENTRY|pkg|ns.Inner.go()',
      ]);
    });

    it('leaves the log itself out, as it heads no row', () => {
      expect(ids.pathIdOf(0)).toBeUndefined();
    });
  });

  describe('pathsEndingIn', () => {
    /** The ids a key heads, over the paths the table has been asked for. */
    function found(...keys: string[]): number[] {
      return ids.pathsEndingIn(new Set(keys.map((key) => ids.keyId(key))));
    }

    it('names the rows a frame is, and not the rows of the callers above it', () => {
      const own = pathFor(ids, 'A');
      const elsewhere = pathFor(ids, 'B', 'A');
      // A row for the caller of A, which stands for that caller and not for A.
      pathFor(ids, 'A', 'C');

      expect(found('A').sort()).toEqual([own, elsewhere].sort());
    });

    it('answers for several frames at once, which one pointed-at row can name', () => {
      const a = pathFor(ids, 'A');
      const b = pathFor(ids, 'B');

      expect(found('A', 'B').sort()).toEqual([a, b].sort());
    });

    it('leaves the empty path out, since no row stands for it, and asks nothing of no keys', () => {
      pathFor(ids, 'A');

      expect(found()).toEqual([]);
      expect(found('Z')).toEqual([]);
    });
  });
});
