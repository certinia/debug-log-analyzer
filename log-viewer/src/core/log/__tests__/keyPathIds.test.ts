/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { KeyPathIds, ROOT_PATH_ID } from '../keyPathIds.js';

describe('KeyPathIds', () => {
  let ids: KeyPathIds;
  beforeEach(() => {
    ids = new KeyPathIds();
  });

  /** Interns a whole path, named outermost key first as a row reads. */
  function pathFor(table: KeyPathIds, ...keys: string[]): number {
    return table.pathOf([...keys].reverse());
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

  it('names the two directions apart, since a row means each in one view only', () => {
    const chain = ['leaf', 'caller'];

    // Top-down names the whole chain; bottom-up names the leaf, then the leaf
    // under its caller.
    expect(ids.prefixesOf(chain)).toEqual([pathFor(ids, 'leaf'), expect.any(Number)]);
    expect(ids.prefixesOf(chain)[1]).not.toBe(ids.pathOf(chain));
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

  it('mints on its own, so an id from one log means nothing to another', () => {
    const other = new KeyPathIds();

    expect(pathFor(other, 'Z')).toBe(pathFor(ids, 'A'));
    expect(other.keysOf(pathFor(other, 'Z'))).toEqual(['Z']);
    expect(ids.keysOf(pathFor(ids, 'A'))).toEqual(['A']);
  });
});
