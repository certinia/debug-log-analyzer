/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { PixelBucket } from '../../../types/flamechart.types.js';
import type { MatchedEventInfo } from '../../../types/search.types.js';
import type { BatchColorInfo } from '../../BucketColorResolver.js';
import { colorToGreyscale } from '../../rendering/ColorUtils.js';
import { buildMatchIndex, resolveBucketSearchColor } from '../SearchBucketMatcher.js';

const SOQL = 0xff0000;
const METHOD = 0x00ff00;

const batchColors = new Map<string, BatchColorInfo>([
  ['SOQL', { color: SOQL }],
  ['Method', { color: METHOD }],
] as Array<[string, BatchColorInfo]>);

function match(timestamp: number, depth: number, category: string): MatchedEventInfo {
  return { timestamp, duration: 0, depth, category };
}

function bucket(timeStart: number, timeEnd: number, depth: number): PixelBucket {
  return { x: 0, y: 0, depth, timeStart, timeEnd, color: 0x336699 } as unknown as PixelBucket;
}

describe('buildMatchIndex', () => {
  it('groups by depth and orders each depth by timestamp', () => {
    const index = buildMatchIndex([
      match(30, 1, 'SOQL'),
      match(10, 0, 'Method'),
      match(20, 1, 'Method'),
    ]);

    expect([...index.keys()].sort()).toEqual([0, 1]);
    expect(index.get(1)?.map((m) => m.timestamp)).toEqual([20, 30]);
  });

  // The renderer asks once a frame while the matches stand still.
  it('answers the same index for the same matches', () => {
    const matches = [match(10, 0, 'SOQL')];

    expect(buildMatchIndex(matches)).toBe(buildMatchIndex(matches));
  });

  it('builds a fresh index for a different set of matches', () => {
    expect(buildMatchIndex([match(10, 0, 'SOQL')])).not.toBe(
      buildMatchIndex([match(10, 0, 'SOQL')]),
    );
  });
});

describe('resolveBucketSearchColor', () => {
  it('greys a bucket at a depth with no match', () => {
    const index = buildMatchIndex([match(10, 3, 'SOQL')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(
      colorToGreyscale(0x336699),
    );
  });

  it('greys a bucket whose depth matches but whose time range does not', () => {
    const index = buildMatchIndex([match(500, 0, 'SOQL')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(
      colorToGreyscale(0x336699),
    );
  });

  it('colours a bucket from the matches inside it', () => {
    const index = buildMatchIndex([match(50, 0, 'SOQL')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(SOQL);
  });

  // Half-open: the start is inside the bucket, the end belongs to the next one.
  it.each([
    ['the start', 0, SOQL],
    ['the end', 100, colorToGreyscale(0x336699)],
  ])('treats a match on %s as tabulator does', (_edge, timestamp, expected) => {
    const index = buildMatchIndex([match(timestamp, 0, 'SOQL')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(expected);
  });

  it('ignores a match carrying no category', () => {
    const index = buildMatchIndex([match(50, 0, '')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(
      colorToGreyscale(0x336699),
    );
  });

  // The counts are held in one reused map, so a bucket must not read the last one's.
  it('counts only its own matches when resolving one bucket after another', () => {
    const index = buildMatchIndex([
      match(10, 0, 'Method'),
      match(20, 0, 'Method'),
      match(150, 0, 'SOQL'),
    ]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(METHOD);
    expect(resolveBucketSearchColor(bucket(100, 200, 0), index, batchColors)).toBe(SOQL);
    expect(resolveBucketSearchColor(bucket(200, 300, 0), index, batchColors)).toBe(
      colorToGreyscale(0x336699),
    );
  });
});
