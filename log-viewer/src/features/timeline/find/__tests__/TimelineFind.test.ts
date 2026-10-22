/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';

import { SearchCursorImpl } from '../../optimised/search/SearchCursor.js';
import type { EventNode } from '../../types/flamechart.types.js';
import type { FramePredicate, SearchMatch } from '../../types/search.types.js';
import { TimelineFind } from '../TimelineFind.js';

const query = (text: string, matchCase = false) => ({ text, matchCase });

// Match i starts at i * 10.
function setup(total = 3) {
  const matches = Array.from(
    { length: total },
    (_, i) => ({ rect: { timeStart: i * 10 } }) as SearchMatch<EventNode>,
  );
  let bounds = { timeStart: 0, timeEnd: 100, depthStart: 0, depthEnd: 10 };
  let cursor: SearchCursorImpl<EventNode> | undefined;
  const chart = {
    search: jest.fn(async (_predicate: FramePredicate): Promise<number | null> => {
      cursor = new SearchCursorImpl(matches);
      return total;
    }),
    setCurrentMatch: jest.fn((index: number) => void cursor?.seek(index)),
    getSearchCursor: () => cursor,
    clearSearch: jest.fn(() => {
      cursor = undefined;
    }),
    getViewportBounds: () => bounds,
  };
  const view = (timeStart: number, timeEnd: number): void => {
    bounds = { ...bounds, timeStart, timeEnd };
  };
  const onClear = jest.fn();
  return { chart, onClear, view, find: new TimelineFind(chart, onClear) };
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
  ])('searches again for %s, with the old matches lit until then', async (_name, next) => {
    const { chart, onClear, find } = setup();
    await find.find(query('foo'));
    await find.setCurrentMatch(1);

    expect(await find.find(next)).toEqual({ total: 3, current: -1 });
    expect(chart.search).toHaveBeenCalledTimes(2);
    expect(chart.clearSearch).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
  });

  it('answers a query from its own scan, not the old matches it replaces', async () => {
    const { chart, find, view } = setup();
    await find.find(query('zzz'));
    let finish = (_total: number | null): void => {};
    chart.search.mockImplementationOnce(
      () => new Promise<number | null>((resolve) => (finish = resolve)),
    );
    const first = find.find(query('foo'));
    view(0, 100);

    expect(find.nearView('next')).toBe(-1);
    const again = find.find(query('foo'));
    finish(null);
    expect(await first).toBeNull();
    expect(await again).toEqual({ total: 3, current: -1 });
    expect(chart.search).toHaveBeenCalledTimes(3);
  });

  it('gives null, and no nearest match, for a scan a clear stopped', async () => {
    const { chart, find, view } = setup();
    let finish = (_total: number | null): void => {};
    chart.search.mockImplementationOnce(
      () => new Promise<number | null>((resolve) => (finish = resolve)),
    );
    chart.clearSearch.mockImplementationOnce(() => finish(null));
    const running = find.find(query('foo'));
    find.clearFind();
    view(0, 100);

    expect(await running).toBeNull();
    expect(find.nearView('next')).toBe(-1);
  });

  it('gives null when a newer search stopped its scan', async () => {
    const { chart, find } = setup();
    chart.search.mockResolvedValueOnce(null);

    expect(await find.find(query('foo'))).toBeNull();
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

  it.each([
    ['the first starting in the view, for next', 'next', 15, 25, 2],
    ['the last starting in the view, for prev', 'prev', 5, 25, 2],
    ['none past the last, for next', 'next', 25, 40, -1],
    ['none before the first, for prev', 'prev', -10, 0, -1],
  ] as const)('gives %s', async (_name, direction, start, end, match) => {
    const { find, view } = setup();
    await find.find(query('foo'));
    view(start, end);

    expect(find.nearView(direction)).toBe(match);
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
