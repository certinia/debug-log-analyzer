/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { SearchCursorImpl } from '../../optimised/search/SearchCursor.js';
import type { EventNode } from '../../types/flamechart.types.js';
import type { FramePredicate, SearchMatch } from '../../types/search.types.js';
import { TimelineFind } from '../TimelineFind.js';

const query = (text: string, matchCase = false) => ({ text, matchCase });

/** A chart whose search owns the cursor, as the real one does. */
function setup(total = 3) {
  const matches = Array.from({ length: total }, () => ({}) as SearchMatch<EventNode>);
  let cursor: SearchCursorImpl<EventNode> | undefined;
  const chart = {
    search: jest.fn((_predicate: FramePredicate) => {
      cursor = new SearchCursorImpl(matches);
      return total;
    }),
    setCurrentMatch: jest.fn((index: number) => void cursor?.seek(index)),
    getSearchCursor: () => cursor,
    clearSearch: jest.fn(() => {
      cursor = undefined;
    }),
  };
  const onClear = jest.fn();
  return { chart, onClear, find: new TimelineFind(chart, onClear) };
}

describe('TimelineFind', () => {
  it('marks the matches of a new query with none current', async () => {
    const { chart, find } = setup();

    expect(await find.find(query('foo', true))).toEqual({ total: 3, current: -1 });
    const predicate = chart.search.mock.calls[0]?.[0];
    expect([predicate?.('a foo', ''), predicate?.('a Foo', '')]).toEqual([true, false]);
  });

  it('keeps the current match for the same query, without searching again', async () => {
    const { chart, find } = setup();
    await find.find(query('foo'));
    await find.setCurrentMatch(1);

    expect(await find.find(query('foo'))).toEqual({ total: 3, current: 1 });
    expect(chart.search).toHaveBeenCalledTimes(1);
  });

  it('searches again when the chart dropped its search', async () => {
    const { chart, find } = setup();
    await find.find(query('foo'));
    await find.setCurrentMatch(1);
    chart.clearSearch();

    expect(await find.find(query('foo'))).toEqual({ total: 3, current: -1 });
    expect(chart.search).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['other text', query('bar')],
    ['the case option', query('foo', true)],
  ])('drops the old search and searches again for %s', async (_name, next) => {
    const { chart, onClear, find } = setup();
    await find.find(query('foo'));
    await find.setCurrentMatch(1);

    expect(await find.find(next)).toEqual({ total: 3, current: -1 });
    expect(chart.search).toHaveBeenCalledTimes(2);
    expect(onClear).toHaveBeenCalled();
  });

  it('finds nothing for no text', async () => {
    const { chart, find } = setup();

    expect(await find.find(query(''))).toEqual({ total: 0, current: -1 });
    expect(chart.search).not.toHaveBeenCalled();
  });

  it('makes no match current for -1', async () => {
    const { find } = setup();
    await find.find(query('foo'));
    await find.setCurrentMatch(2);
    await find.setCurrentMatch(-1);

    expect(await find.find(query('foo'))).toEqual({ total: 3, current: -1 });
  });

  it('leaves the chart alone for -1 when none is current', async () => {
    const { chart, find } = setup();
    await find.find(query('foo'));
    await find.setCurrentMatch(-1);

    expect(chart.setCurrentMatch).not.toHaveBeenCalled();
  });

  it('leaves the chart still for a match a search again kept', async () => {
    const { chart, find } = setup();
    await find.find(query('foo'));
    await find.setCurrentMatch(1);
    await find.setCurrentMatch(1, true);

    expect(chart.setCurrentMatch).toHaveBeenCalledTimes(1);
  });

  it('clears the chart and searches the same query afresh after a clear', async () => {
    const { chart, onClear, find } = setup();
    await find.find(query('foo'));
    find.clearFind();

    expect(chart.clearSearch).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
    await find.find(query('foo'));
    expect(chart.search).toHaveBeenCalledTimes(2);
  });

  it('clears nothing when it holds no search', () => {
    const { chart, onClear, find } = setup();
    find.clearFind();

    expect(chart.clearSearch).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });
});
