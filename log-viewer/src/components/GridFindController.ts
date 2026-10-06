/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveControllerHost } from 'lit';
import type { RowComponent, Tabulator } from 'tabulator-tables';

import { DomListenerController } from '../core/events/DomListenerController.js';
import type { FindEventDetail, FindEventMap } from '../features/find/findEvents.js';

export interface GridFindOptions {
  /** The grid to search, read late: the table is built well after the host connects. */
  table: () => Tabulator | null;
  /** Hands the count to whatever shows it. */
  report: (totalMatches: number) => void;
}

/**
 * Owns one grid's half of the find widget: the search itself, stepping to a
 * match, and dropping both when the grid is reshaped under them.
 *
 * `lv-find` is app-wide, so this listens on `document` and every grid hears
 * every search. A grid with no rendered table answers nothing, which is what
 * keeps the hidden tabs quiet.
 *
 * The Analysis and Call Tree grids are deliberately not on this. They run the
 * same search but fold stepping into it, report through `lv-find-results`
 * rather than `db-find-results`, and also answer `lv-find-match` — three
 * behavioural differences, none of them currently covered by a test.
 */
export class GridFindController {
  findArgs: FindEventDetail = {
    text: '',
    count: 0,
    options: { matchCase: false },
  };
  findMap: { [key: number]: RowComponent } = {};
  totalMatches = 0;

  /**
   * Raised while this controller is the one changing the table, so the grid's own
   * sort, group and filter handlers do not read its work as the user reshaping the
   * grid out from under a live search.
   */
  blockClearHighlights = true;

  private readonly _options: GridFindOptions;

  constructor(host: ReactiveControllerHost, options: GridFindOptions) {
    this._options = options;
    new DomListenerController<FindEventMap>(host, document, {
      'lv-find': (e) => void this.find(e),
      'lv-find-close': (e) => void this.find(e),
    });
  }

  async find(e: CustomEvent<FindEventDetail>): Promise<void> {
    const table = this._options.table();
    const isTableVisible = !!table?.element?.clientHeight;
    if (!isTableVisible && !this.totalMatches) {
      return;
    }

    const newFindArgs = JSON.parse(JSON.stringify(e.detail)) as FindEventDetail;
    const newSearch =
      newFindArgs.text !== this.findArgs.text ||
      newFindArgs.options.matchCase !== this.findArgs.options?.matchCase;
    this.findArgs = newFindArgs;

    const clearHighlights = e.type === 'lv-find-close';
    if (clearHighlights) {
      newFindArgs.text = '';
    }
    if (!newSearch && !clearHighlights) {
      return;
    }

    this.blockClearHighlights = true;
    //@ts-expect-error This is a custom function added in by Find custom module
    const result = await table.find(this.findArgs);
    this.blockClearHighlights = false;
    this.totalMatches = result.totalMatches;
    this.findMap = result.matchIndexes;

    if (!clearHighlights) {
      this._options.report(result.totalMatches);
    }
  }

  // todo: fix search on grouped data
  async highlight(index: number): Promise<void> {
    const table = this._options.table();
    if (!table?.element?.clientHeight) {
      return;
    }

    this.findArgs.count = index;
    const currentRow = this.findMap[index];
    this.blockClearHighlights = true;
    //@ts-expect-error This is a custom function added in by Find custom module
    await table.setCurrentMatch(index, currentRow, {
      scrollIfVisible: false,
      focusRow: false,
    });
    this.blockClearHighlights = false;
  }

  /** Tells the widget this grid has nothing, without touching the grid. */
  reset(): void {
    this._options.report(0);
  }

  /** Drops the search, in the grid and in the widget. */
  clear(): void {
    this.findArgs.text = '';
    this.findArgs.count = 0;
    //@ts-expect-error This is a custom function added in by Find custom module
    this._options.table()?.clearFindHighlights();
    this.findMap = {};
    this.totalMatches = 0;

    this._options.report(this.totalMatches);
  }

  /**
   * Sorting, grouping or filtering moves the rows a search matched, so the
   * highlights no longer mean anything. Ignored while this controller is the one
   * doing the moving.
   */
  dropOnReshape(): void {
    if (!this.blockClearHighlights && this.totalMatches > 0) {
      this.reset();
      this.clear();
    }
  }
}
