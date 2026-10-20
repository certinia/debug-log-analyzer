/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { fakeHost, type FakeHost } from '#test-helpers/fakeHost.js';
import { FindController, type FindTarget } from '../FindController.js';

function gridStub(total = 3) {
  return {
    find: jest.fn(async (_query: unknown): Promise<{ total: number; current: number } | null> => ({
      total,
      current: -1,
    })),
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

describe('FindController', () => {
  let host: FakeHost & HTMLElement;
  let height: number;
  let grids: Stub[];
  let reported: number[];
  // The widget's current match each report gave, from 1; 0 for none.
  let positions: number[];
  let finder: FindController;
  const onResults = (e: Event): void => {
    const { totalMatches, currentMatch } = (
      e as CustomEvent<{ totalMatches: number; currentMatch: number }>
    ).detail;
    reported.push(totalMatches);
    positions.push(currentMatch);
  };

  beforeEach(() => {
    host = fakeHost(document.createElement('div'));
    height = 20;
    Object.defineProperty(host, 'clientHeight', { get: () => height });
    grids = [gridStub()];
    reported = [];
    positions = [];
    finder = new FindController(host, {
      targets: () => grids as unknown as FindTarget[],
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
    ['searches the same query again, as when its view is shown again', 'update', false, 2],
    ['searches again when only the case option changed', 'update', true, 2],
    ['searches again when the text changed', 'insert', false, 2],
  ])('%s', async (_name, text, matchCase, searches) => {
    await finder.find(findEvent('lv-find', 'update'));
    await finder.find(findEvent('lv-find', text, { matchCase }));

    expect(grids[0]?.find).toHaveBeenCalledTimes(searches);
  });

  it('answers nothing while the host is off screen', async () => {
    await finder.find(findEvent('lv-find', 'foo'));
    const grid = grids[0];
    height = 0;
    await finder.find(findEvent('lv-find', 'bar'));
    await finder.find(findEvent('lv-find-match', 'bar', { count: 2 }));

    expect(grid?.find).toHaveBeenCalledTimes(1);
    expect(grid?.setCurrentMatch).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([3]);
  });

  it('keeps the newest query while the host is off screen, and searches it once shown', async () => {
    await finder.find(findEvent('lv-find', 'foo'));
    const grid = grids[0];
    height = 0;
    await finder.find(findEvent('lv-find', 'bar'));
    expect(grid?.clearFind).toHaveBeenCalledTimes(1);

    height = 20;
    await finder.rerun();
    expect(grid?.find).toHaveBeenLastCalledWith({ text: 'bar', matchCase: false });
    expect(reported).toEqual([3, 3]);
  });

  it.each([
    ['starts at the first match', 1, 1, [[0]]],
    ['searches without moving', 0, 0, [[-1]]],
  ])('for a new query, %s', async (_name, count, position, marks) => {
    await finder.find(findEvent('lv-find', 'update', { count }));

    expect(positions).toEqual([position]);
    expect(grids[0]?.setCurrentMatch.mock.calls).toEqual(marks);
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
    grids[0]?.find.mockResolvedValueOnce(null);
    await finder.find(findEvent('lv-find', 'update'));
    expect(grids[0]?.clearFind).toHaveBeenCalledTimes(1);
    expect(reported).toEqual([0]);

    await finder.find(findEvent('lv-find', 'update'));
    expect(reported).toEqual([0, 3]);
  });

  it('reports only the newest of two searches', async () => {
    let finish: (result: { total: number; current: number }) => void = () => undefined;
    grids[0]?.find.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const first = finder.find(findEvent('lv-find', 'up'));
    await finder.find(findEvent('lv-find', 'update'));
    finish({ total: 9, current: -1 });
    await first;

    expect(reported).toEqual([3]);
    expect(finder.totalMatches).toBe(3);
  });

  describe('rerun', () => {
    it('does nothing with no search', async () => {
      await finder.rerun();

      expect(grids[0]?.find).not.toHaveBeenCalled();
      expect(reported).toEqual([]);
    });

    it('searches again, reports the current match where its grid kept it, and brings it into view', async () => {
      grids = [gridStub(2), gridStub(3)];
      await finder.find(findEvent('lv-find', 'update', { count: 1, matchCase: true }));
      grids[0]?.find.mockResolvedValueOnce({ total: 4, current: -1 });
      grids[1]?.find.mockResolvedValueOnce({ total: 1, current: 0 });
      await finder.rerun();

      expect(grids[1]?.find).toHaveBeenCalledWith({ text: 'update', matchCase: true });
      expect(reported).toEqual([5, 5]);
      expect(positions).toEqual([1, 5]);
      expect(finder.totalMatches).toBe(5);
      expect(grids[1]?.setCurrentMatch.mock.calls.at(-1)).toEqual([0]);
    });

    it('reports no current match when no grid kept one', async () => {
      await finder.find(findEvent('lv-find', 'update', { count: 1 }));
      await finder.rerun();

      expect(positions).toEqual([1, 0]);
      expect(grids[0]?.setCurrentMatch.mock.calls).toEqual([[0]]);
    });

    it('clears every grid when the host is off screen', async () => {
      grids = [gridStub(), gridStub()];
      await finder.find(findEvent('lv-find', 'update'));
      height = 0;
      await finder.rerun();

      expect(grids.map((grid) => grid.clearFind.mock.calls.length)).toEqual([1, 1]);
      expect(finder.totalMatches).toBe(0);
      expect(reported).toEqual([6]);
    });

    it('clears the search when a rebuild replaced it', async () => {
      await finder.find(findEvent('lv-find', 'update'));
      grids[0]?.find.mockResolvedValueOnce(null);
      await finder.rerun();

      expect(reported).toEqual([3, 0]);
      expect(finder.totalMatches).toBe(0);
    });

    it('ignores a move to a match while it runs, as the move counts by the old totals', async () => {
      grids = [gridStub(2), gridStub(3)];
      await finder.find(findEvent('lv-find', 'update', { count: 1 }));
      let finish: (result: { total: number; current: number }) => void = () => undefined;
      grids[1]?.find.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
      const running = finder.rerun();
      await Promise.resolve();
      await finder.find(findEvent('lv-find-match', 'update', { count: 2 }));
      finish({ total: 3, current: -1 });
      await running;

      expect(grids[0]?.setCurrentMatch.mock.calls).toEqual([[0]]);
      expect(positions).toEqual([1, 0]);
    });

    it.each([
      ['a newer rerun', (): Promise<void> => finder.rerun()],
      ['a close', (): Promise<void> => finder.find(findEvent('lv-find-close', ''))],
    ])('reports nothing for a rerun %s replaced', async (_name, replace) => {
      await finder.find(findEvent('lv-find', 'update'));
      let finish: (result: { total: number; current: number }) => void = () => undefined;
      grids[0]?.find.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
      const running = finder.rerun();
      await Promise.resolve();
      await replace();
      finish({ total: 9, current: 0 });
      await running;

      expect(reported).not.toContain(9);
    });
  });

  describe('with folded grids', () => {
    let calls: string[];
    // An unfold of the second grid waits on this while it is set.
    let held: Promise<void> | null;
    let folded: FindController;

    beforeEach(() => {
      calls = [];
      held = null;
      grids = [gridStub(2), gridStub(3)];
      grids.forEach((grid, i) =>
        grid.setCurrentMatch.mockImplementation(async (match) => {
          calls.push(`mark ${i}:${match}`);
        }),
      );
      folded = new FindController(host, {
        targets: () => grids as unknown as FindTarget[],
        unfold: async (grid) => {
          const i = grids.indexOf(grid as unknown as Stub);
          calls.push(`unfold ${i}`);
          if (i === 1 && held) {
            await held;
          }
        },
      });
    });

    it('unfolds the grid that holds a match before a step marks it', async () => {
      await folded.find(findEvent('lv-find', 'update', { count: 1 }));
      calls = [];
      await folded.find(findEvent('lv-find-match', 'update', { count: 4 }));

      expect(calls.indexOf('unfold 1')).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf('unfold 1')).toBeLessThan(calls.indexOf('mark 1:1'));
    });

    it('unfolds the grid of the first match for a new search', async () => {
      grids[0]?.find.mockResolvedValueOnce({ total: 0, current: -1 });
      await folded.find(findEvent('lv-find', 'update', { count: 1 }));

      expect(calls).toContain('unfold 1');
    });

    it('marks the kept match on a rerun without unfolding its grid', async () => {
      await folded.find(findEvent('lv-find', 'update'));
      grids[1]?.find.mockResolvedValueOnce({ total: 3, current: 1 });
      calls = [];
      await folded.rerun();

      expect(calls).toContain('mark 1:1');
      expect(calls.filter((call) => call.startsWith('unfold'))).toEqual([]);
    });

    it('marks nothing for a step a newer one replaced while it unfolded', async () => {
      await folded.find(findEvent('lv-find', 'update', { count: 1 }));
      let open: () => void = () => undefined;
      held = new Promise((resolve) => (open = resolve));
      const slow = folded.find(findEvent('lv-find-match', 'update', { count: 4 }));
      await folded.find(findEvent('lv-find-match', 'update', { count: 2 }));
      open();
      await slow;

      expect(grids[1]?.setCurrentMatch.mock.calls.at(-1)).toEqual([-1]);
      expect(grids[0]?.setCurrentMatch.mock.calls.at(-1)).toEqual([1]);
    });
  });
});
