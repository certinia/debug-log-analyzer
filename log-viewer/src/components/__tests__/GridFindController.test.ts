/**
 * @vitest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tabulator } from 'tabulator-tables';

import { fakeHost, type FakeHost } from '#test-helpers/fakeHost.js';
import { GridFindController } from '../GridFindController.js';

const FOUND = { totalMatches: 3, matchIndexes: { 0: {}, 1: {} } };

function tableStub(clientHeight = 20) {
  return {
    element: { clientHeight },
    find: vi.fn(async (_args: unknown) => FOUND),
    clearFindHighlights: vi.fn(),
    setCurrentMatch: vi.fn(async (_index: number, _row: unknown, _options: unknown) => undefined),
  };
}

const findEvent = (type: 'lv-find' | 'lv-find-close', text: string, matchCase = false) =>
  new CustomEvent(type, { detail: { text, count: 0, options: { matchCase } } });

describe('GridFindController', () => {
  let host: FakeHost;
  let table: ReturnType<typeof tableStub> | null;
  let reported: number[];
  let finder: GridFindController;

  beforeEach(() => {
    host = fakeHost();
    table = tableStub();
    reported = [];
    finder = new GridFindController(host, {
      table: () => table as unknown as Tabulator | null,
      report: (total) => reported.push(total),
    });
    host.connect();
  });

  afterEach(() => {
    host.disconnect();
  });

  describe('find', () => {
    it('searches the table and reports the count', async () => {
      await finder.find(findEvent('lv-find', 'update'));

      expect(table?.find).toHaveBeenCalledTimes(1);
      expect(finder.totalMatches).toBe(3);
      expect(finder.findMap).toBe(FOUND.matchIndexes);
      expect(reported).toEqual([3]);
    });

    it('answers a find raised on the document, not only a direct call', async () => {
      document.dispatchEvent(findEvent('lv-find', 'update'));
      await Promise.resolve();

      expect(table?.find).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['does not search again for the same text and case option', 'update', false, 1],
      ['searches again when only the case option changed', 'update', true, 2],
      ['searches again when the text changed', 'insert', false, 2],
    ])('%s', async (_name, text, matchCase, searches) => {
      await finder.find(findEvent('lv-find', 'update'));
      await finder.find(findEvent('lv-find', text, matchCase));

      expect(table?.find).toHaveBeenCalledTimes(searches);
    });

    it('drops the text and reports nothing when the widget closes', async () => {
      await finder.find(findEvent('lv-find', 'update'));
      reported.length = 0;

      await finder.find(findEvent('lv-find-close', 'update'));

      expect(table?.find).toHaveBeenCalledTimes(2);
      expect(finder.findArgs.text).toBe('');
      // The widget is closing, so it is not told what it would have found.
      expect(reported).toEqual([]);
    });

    it('copies the detail rather than holding the event', async () => {
      const event = findEvent('lv-find', 'update');
      await finder.find(event);

      expect(finder.findArgs).not.toBe(event.detail);
      expect(finder.findArgs.text).toBe('update');
    });

    it.each([
      ['a hidden table', () => tableStub(0)],
      ['no table yet', () => null],
    ])('does nothing for %s that never matched', async (_name, make) => {
      table = make();

      await finder.find(findEvent('lv-find', 'update'));

      expect(finder.findArgs.text).toBe('');
      expect(reported).toEqual([]);
    });

    it('still answers a hidden table that has matches standing', async () => {
      const find = vi.fn(async (_args: unknown) => FOUND);
      table = { ...tableStub(), find };
      await finder.find(findEvent('lv-find', 'update'));
      table = { ...tableStub(0), find };

      await finder.find(findEvent('lv-find', 'insert'));

      expect(find).toHaveBeenCalledTimes(2);
    });
  });

  describe('highlight', () => {
    it('marks the match at the index, without scrolling or taking focus', async () => {
      await finder.find(findEvent('lv-find', 'update'));

      await finder.highlight(1);

      expect(table?.setCurrentMatch).toHaveBeenCalledWith(1, finder.findMap[1], {
        scrollIfVisible: false,
        focusRow: false,
      });
      expect(finder.findArgs.count).toBe(1);
    });

    // The guard is what stops the grid's own `dataFiltering` from dropping the match.
    it('holds the guard up only while the match is being marked', async () => {
      await finder.find(findEvent('lv-find', 'update'));
      let guardWhileMarking;
      table?.setCurrentMatch.mockImplementation(async () => {
        guardWhileMarking = finder.blockClearHighlights;
      });

      await finder.highlight(1);

      expect(guardWhileMarking).toBe(true);
      expect(finder.blockClearHighlights).toBe(false);
    });

    it('does nothing where the table is hidden', async () => {
      table = tableStub(0);

      await finder.highlight(1);

      expect(table.setCurrentMatch).not.toHaveBeenCalled();
      expect(finder.findArgs.count).toBe(0);
    });
  });

  describe('dropping a search', () => {
    it('reset reports an empty count without touching the grid', () => {
      finder.reset();

      expect(reported).toEqual([0]);
      expect(table?.clearFindHighlights).not.toHaveBeenCalled();
    });

    it('clear drops the highlights, the map and the count', async () => {
      await finder.find(findEvent('lv-find', 'update'));
      await finder.highlight(1);
      reported.length = 0;

      finder.clear();

      expect(table?.clearFindHighlights).toHaveBeenCalledTimes(1);
      expect(finder.findArgs.text).toBe('');
      expect(finder.findArgs.count).toBe(0);
      expect(finder.findMap).toEqual({});
      expect(finder.totalMatches).toBe(0);
      expect(reported).toEqual([0]);
    });

    it.each([
      ['drops standing matches when the grid is reshaped', true, false, [0, 0]],
      ['ignores a reshape this controller is making', true, true, []],
      ['ignores a reshape with no matches standing', false, false, []],
    ])('%s', async (_name, matched, blocked, expected) => {
      if (matched) {
        await finder.find(findEvent('lv-find', 'update'));
      }
      finder.blockClearHighlights = blocked;
      reported.length = 0;

      finder.dropOnReshape();

      expect(reported).toEqual(expected);
    });
  });
});
