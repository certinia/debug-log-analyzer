/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { MatchedEventInfo } from '../../../types/search.types.js';
import type { BatchColorInfo } from '../../BucketColorResolver.js';
import { colorToGreyscale } from '../../rendering/ColorUtils.js';
import { buildMatchIndex, resolveBucketSearchColor } from '../SearchBucketMatcher.js';

const DML = 0xff0000;
const SOQL = 0x00ff00;
const BUCKET = 0x336699;
const GREY = colorToGreyscale(BUCKET);

// `Unranked` stands outside CATEGORY_PRIORITY, which nothing upstream produces today.
const UNRANKED = 0x0000ff;

const batchColors = new Map<string, BatchColorInfo>([
  ['DML', { color: DML }],
  ['SOQL', { color: SOQL }],
  ['Unranked', { color: UNRANKED }],
]);

function match(timestamp: number, depth: number, category: string): MatchedEventInfo {
  return { timestamp, duration: 0, depth, category };
}

function bucket(timeStart: number, timeEnd: number, depth: number) {
  return { depth, timeStart, timeEnd, color: BUCKET };
}

describe('buildMatchIndex', () => {
  it('groups by depth and orders each depth by timestamp', () => {
    const index = buildMatchIndex([
      match(30, 1, 'DML'),
      match(10, 0, 'SOQL'),
      match(20, 1, 'SOQL'),
    ]);

    expect([...index.keys()].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(index.get(1)?.map((m) => m.timestamp)).toEqual([20, 30]);
  });

  it('answers the same index for the same matches', () => {
    const matches = [match(10, 0, 'DML')];

    expect(buildMatchIndex(matches)).toBe(buildMatchIndex(matches));
  });

  it('builds a fresh index for a different set of matches', () => {
    expect(buildMatchIndex([match(10, 0, 'DML')])).not.toBe(buildMatchIndex([match(10, 0, 'DML')]));
  });
});

describe('resolveBucketSearchColor', () => {
  it('greys a bucket at a depth with no match', () => {
    const index = buildMatchIndex([match(10, 3, 'DML')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(GREY);
  });

  it('greys a bucket whose depth matches but whose time range does not', () => {
    const index = buildMatchIndex([match(500, 0, 'DML')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(GREY);
  });

  it('colours a bucket from the matches inside it', () => {
    const index = buildMatchIndex([match(50, 0, 'DML')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(DML);
  });

  it('takes the highest-priority category present', () => {
    const index = buildMatchIndex([match(50, 0, 'SOQL'), match(60, 0, 'DML')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(DML);
  });

  it('colours a bucket from a category the priority order does not rank', () => {
    const index = buildMatchIndex([match(50, 0, 'Unranked')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(UNRANKED);
  });

  it('gives a tie between unranked categories to the first match', () => {
    const index = buildMatchIndex([match(50, 0, 'Unranked'), match(60, 0, 'AlsoUnranked')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(UNRANKED);
  });

  it('counts a match on the bucket start, the range being half-open', () => {
    const index = buildMatchIndex([match(0, 0, 'DML')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(DML);
  });

  it('leaves a match on the bucket end to the next bucket', () => {
    const index = buildMatchIndex([match(100, 0, 'DML')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(GREY);
  });

  it('ignores a match carrying no category', () => {
    const index = buildMatchIndex([match(50, 0, '')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(GREY);
  });

  // Each bucket seeks its own start in the shared depth array.
  it('reads only its own matches when resolving one bucket after another', () => {
    const index = buildMatchIndex([
      match(10, 0, 'SOQL'),
      match(20, 0, 'SOQL'),
      match(150, 0, 'DML'),
    ]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(SOQL);
    expect(resolveBucketSearchColor(bucket(100, 200, 0), index, batchColors)).toBe(DML);
    expect(resolveBucketSearchColor(bucket(200, 300, 0), index, batchColors)).toBe(GREY);
  });
});
