/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { fakeHost, type FakeHost } from '#test-helpers/fakeHost.js';
import { LvGridFindController, type FindableGrid } from '../LvGridFindController.js';

function gridStub(clientHeight = 20) {
  return {
    clientHeight,
    find: jest.fn(async (_query: unknown) => 3),
    setCurrentMatch: jest.fn(async (_match: number) => undefined),
    clearFind: jest.fn(),
  };
}

const findEvent = (type: 'lv-find' | 'lv-find-close', text: string, matchCase = false) =>
  new CustomEvent(type, { detail: { text, count: 0, options: { matchCase } } });

describe('LvGridFindController', () => {
  let host: FakeHost;
  let grid: ReturnType<typeof gridStub> | null;
  let reported: number[];
  let finder: LvGridFindController;

  beforeEach(() => {
    host = fakeHost();
    grid = gridStub();
    reported = [];
    finder = new LvGridFindController(host, {
      grid: () => grid as unknown as FindableGrid | null,
      report: (total) => reported.push(total),
    });
    host.connect();
  });

  afterEach(() => {
    host.disconnect();
  });

  it('searches the grid and reports the count', async () => {
    await finder.find(findEvent('lv-find', 'update', true));

    expect(grid?.find).toHaveBeenCalledWith({ text: 'update', matchCase: true });
    expect(finder.totalMatches).toBe(3);
    expect(reported).toEqual([3]);
  });

  it('answers a find raised on the document', async () => {
    document.dispatchEvent(findEvent('lv-find', 'update'));
    await Promise.resolve();

    expect(grid?.find).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['does not search again for the same text and case option', 'update', false, 1],
    ['searches again when only the case option changed', 'update', true, 2],
    ['searches again when the text changed', 'insert', false, 2],
  ])('%s', async (_name, text, matchCase, searches) => {
    await finder.find(findEvent('lv-find', 'update'));
    await finder.find(findEvent('lv-find', text, matchCase));

    expect(grid?.find).toHaveBeenCalledTimes(searches);
  });

  it('answers nothing while its grid is not shown and has no matches', async () => {
    grid = gridStub(0);
    await finder.find(findEvent('lv-find', 'update'));

    expect(grid.find).not.toHaveBeenCalled();
    expect(reported).toEqual([]);
  });

  it('clears the grid and searches again after the widget closes', async () => {
    await finder.find(findEvent('lv-find', 'update'));
    await finder.find(findEvent('lv-find-close', 'update'));

    expect(grid?.clearFind).toHaveBeenCalledTimes(1);
    expect(finder.totalMatches).toBe(0);
    expect(reported).toEqual([3]);

    await finder.find(findEvent('lv-find', 'update'));
    expect(grid?.find).toHaveBeenCalledTimes(2);
  });

  it('reports no matches when a rebuild dropped the search', async () => {
    grid?.find.mockResolvedValueOnce(-1);
    await finder.find(findEvent('lv-find', 'update'));

    expect(grid?.clearFind).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([0]);
  });

  it('reports only the newest of two searches', async () => {
    let finish: (total: number) => void = () => undefined;
    grid?.find.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const first = finder.find(findEvent('lv-find', 'up'));
    await finder.find(findEvent('lv-find', 'update'));
    finish(9);
    await first;

    expect(reported).toEqual([3]);
    expect(finder.totalMatches).toBe(3);
  });

  it('marks a match current from the widget count, which starts at 1', async () => {
    await finder.highlight(2);
    await finder.highlight(0);

    expect(grid?.setCurrentMatch.mock.calls).toEqual([[1], [-1]]);
  });

  it('drops the search on a reshape only when it has matches', async () => {
    finder.dropOnReshape();
    expect(reported).toEqual([]);

    await finder.find(findEvent('lv-find', 'update'));
    finder.dropOnReshape();
    expect(grid?.clearFind).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([3, 0]);
  });
});
