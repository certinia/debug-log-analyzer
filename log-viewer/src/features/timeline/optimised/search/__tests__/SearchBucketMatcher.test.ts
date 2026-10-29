/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { rectsOf, timelineEvent } from '#test-helpers/timeline.js';
import { makeViewport } from '#test-helpers/viewport.js';
import type { MatchSpan } from '../../../types/search.types.js';
import type { BatchColorInfo } from '../../BucketColorResolver.js';
import { RectangleCache } from '../../RectangleCache.js';
import { colorToGreyscale } from '../../rendering/ColorUtils.js';
import {
  buildMatchIndex,
  resolveBucketCategoryColor,
  resolveBucketSearchColor,
} from '../SearchBucketMatcher.js';

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

function match(timeStart: number, depth: number, category: string): MatchSpan {
  return { timeStart, depth, category };
}

function bucket(firstStart: number, lastStart: number, depth: number) {
  return { depth, firstStart, lastStart, color: BUCKET };
}

describe('buildMatchIndex', () => {
  it('groups by depth and orders each depth by timestamp', () => {
    const index = buildMatchIndex([
      match(30, 1, 'DML'),
      match(10, 0, 'SOQL'),
      match(20, 1, 'SOQL'),
    ]);

    expect([...index.keys()].sort((a, b) => a - b)).toEqual([0, 1]);
    expect([...index.get(1)!.starts]).toEqual([20, 30]);
    expect(index.get(1)?.categories).toEqual(['SOQL', 'DML']);
  });

  it('answers the same index for the same matches', () => {
    const matches = [match(10, 0, 'DML')];

    expect(buildMatchIndex(matches)).toBe(buildMatchIndex(matches));
  });

  it('builds a fresh index for a different set of matches', () => {
    buildMatchIndex([match(10, 0, 'DML')]);

    expect(buildMatchIndex([match(10, 0, 'SOQL')]).get(0)?.categories).toEqual(['SOQL']);
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

  it('counts a match on the start of the first frame it holds', () => {
    const index = buildMatchIndex([match(0, 0, 'DML')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(DML);
  });

  it('counts a match on the start of the last frame it holds', () => {
    const index = buildMatchIndex([match(100, 0, 'DML')]);

    expect(resolveBucketSearchColor(bucket(0, 100, 0), index, batchColors)).toBe(DML);
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

    expect(resolveBucketSearchColor(bucket(0, 99, 0), index, batchColors)).toBe(SOQL);
    expect(resolveBucketSearchColor(bucket(100, 199, 0), index, batchColors)).toBe(DML);
    expect(resolveBucketSearchColor(bucket(200, 299, 0), index, batchColors)).toBe(GREY);
  });

  // At zoom 1 a cell spans 2ns. [1.5-1.6] and [2.5-2.9] fit in one node, bucketed whole at 1.5.
  it('colours the bucket holding a match that starts past the edge of its cell', () => {
    const rects = rectsOf([timelineEvent(1.5, 0.1, 'Apex'), timelineEvent(2.5, 0.4, 'DML')]);
    const { buckets } = new RectangleCache(rects).getCulledRectangles(makeViewport(), new Map());
    const [held] = [...buckets.values()].flat();
    const index = buildMatchIndex([match(2.5, 0, 'DML')]);

    expect(resolveBucketSearchColor(held!, index, batchColors)).toBe(DML);
  });
});

describe('resolveBucketCategoryColor', () => {
  function holding(...categories: string[]) {
    return {
      categoryStats: {
        byCategory: new Map(
          categories.map((category) => [category, { count: 1, totalDuration: 1 }]),
        ),
        dominantCategory: categories[0] ?? '',
      },
    };
  }

  it('answers nothing for a bucket holding no lit category', () => {
    expect(
      resolveBucketCategoryColor(holding('DML'), new Set(['SOQL']), batchColors),
    ).toBeUndefined();
  });

  it('lights a bucket holding a lit category, even when another dominates it', () => {
    expect(resolveBucketCategoryColor(holding('DML', 'SOQL'), new Set(['SOQL']), batchColors)).toBe(
      SOQL,
    );
  });

  it('takes the higher-priority category when several lit ones share a bucket', () => {
    const lit = new Set(['SOQL', 'DML']);

    expect(resolveBucketCategoryColor(holding('SOQL', 'DML'), lit, batchColors)).toBe(DML);
  });
});
