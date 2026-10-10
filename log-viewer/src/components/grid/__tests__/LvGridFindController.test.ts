/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { fakeHost, type FakeHost } from '#test-helpers/fakeHost.js';
import { LvGridFindController, type FindableGrid } from '../LvGridFindController.js';

function gridStub(total = 3, clientHeight = 20) {
  return {
    clientHeight,
    find: jest.fn(async (_query: unknown) => total),
    setCurrentMatch: jest.fn(async (_match: number) => undefined),
    clearFind: jest.fn(),
  };
}

type Stub = ReturnType<typeof gridStub>;

const findEvent = (
  type: 'lv-find' | 'lv-find-match' | 'lv-find-close',
  text: string,
  { count = 0, matchCase = false } = {},
) => new CustomEvent(type, { detail: { text, count, options: { matchCase } } });

describe('LvGridFindController', () => {
  let host: FakeHost;
  let grids: Stub[];
  let reported: number[];
  let finder: LvGridFindController;
  const onResults = (e: Event): void => {
    reported.push((e as CustomEvent<{ totalMatches: number }>).detail.totalMatches);
  };

  beforeEach(() => {
    host = fakeHost();
    grids = [gridStub()];
    reported = [];
    finder = new LvGridFindController(host, {
      grids: () => grids as unknown as FindableGrid[],
    });
    host.connect();
    document.addEventListener('lv-find-results', onResults);
  });

  afterEach(() => {
    document.removeEventListener('lv-find-results', onResults);
    host.disconnect();
  });

  it('searches the grid and reports the count', async () => {
    await finder.find(findEvent('lv-find', 'update', { matchCase: true }));

    expect(grids[0]?.find).toHaveBeenCalledWith({ text: 'update', matchCase: true });
    expect(finder.totalMatches).toBe(3);
    expect(reported).toEqual([3]);
  });

  it('answers the find events raised on the document', async () => {
    document.dispatchEvent(findEvent('lv-find', 'update'));
    await Promise.resolve();

    expect(grids[0]?.find).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['does not search again for the same text and case option', 'update', false, 1],
    ['searches again when only the case option changed', 'update', true, 2],
    ['searches again when the text changed', 'insert', false, 2],
  ])('%s', async (_name, text, matchCase, searches) => {
    await finder.find(findEvent('lv-find', 'update'));
    await finder.find(findEvent('lv-find', text, { matchCase }));

    expect(grids[0]?.find).toHaveBeenCalledTimes(searches);
  });

  it('answers nothing while no grid is shown and it has no matches', async () => {
    grids = [gridStub(3, 0)];
    await finder.find(findEvent('lv-find', 'update'));

    expect(grids[0]?.find).not.toHaveBeenCalled();
    expect(reported).toEqual([]);
  });

  it('marks the widget count current, from 1, in the grid that holds it', async () => {
    grids = [gridStub(2), gridStub(3)];
    await finder.find(findEvent('lv-find', 'update', { count: 1 }));
    await finder.find(findEvent('lv-find-match', 'update', { count: 4 }));

    expect(reported).toEqual([5]);
    expect(grids[0]?.setCurrentMatch.mock.calls).toEqual([[0], [-1]]);
    expect(grids[1]?.setCurrentMatch.mock.calls).toEqual([[-1], [1]]);
  });

  it('clears every grid and searches again after the widget closes', async () => {
    await finder.find(findEvent('lv-find', 'update'));
    await finder.find(findEvent('lv-find-close', 'update'));

    expect(grids[0]?.clearFind).toHaveBeenCalledTimes(1);
    expect(finder.totalMatches).toBe(0);
    expect(reported).toEqual([3]);

    await finder.find(findEvent('lv-find', 'update'));
    expect(grids[0]?.find).toHaveBeenCalledTimes(2);
  });

  it('reports no matches when a rebuild dropped the search, and searches again next time', async () => {
    grids[0]?.find.mockResolvedValueOnce(-1);
    await finder.find(findEvent('lv-find', 'update'));
    expect(grids[0]?.clearFind).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([0]);

    await finder.find(findEvent('lv-find', 'update'));
    expect(reported).toEqual([0, 3]);
  });

  it('reports only the newest of two searches', async () => {
    let finish: (total: number) => void = () => undefined;
    grids[0]?.find.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const first = finder.find(findEvent('lv-find', 'up'));
    await finder.find(findEvent('lv-find', 'update'));
    finish(9);
    await first;

    expect(reported).toEqual([3]);
    expect(finder.totalMatches).toBe(3);
  });

  it('drops a search on a reshape, even one still running', async () => {
    finder.dropOnReshape();
    expect(reported).toEqual([]);

    let finish: (total: number) => void = () => undefined;
    grids[0]?.find.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const running = finder.find(findEvent('lv-find', 'update'));
    finder.dropOnReshape();
    finish(3);
    await running;

    expect(grids[0]?.clearFind).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([0]);
    expect(finder.totalMatches).toBe(0);
  });
});
