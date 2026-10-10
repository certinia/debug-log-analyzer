/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveControllerHost } from 'lit';

import { DomListenerController } from '../../core/events/DomListenerController.js';
import type { FindEventDetail, FindEventMap } from '../../features/find/findEvents.js';
import type { FindQuery, LvGrid } from '../../grid/index.js';

/** The part of an lv-grid that find drives. */
export type FindableGrid = Pick<LvGrid, 'find' | 'setCurrentMatch' | 'clearFind' | 'clientHeight'>;

export interface LvGridFindOptions {
  /** The grid to search, read late: the grid is made well after the host connects. */
  grid: () => FindableGrid | null;
  /** Hands the count to whatever shows it. */
  report: (totalMatches: number) => void;
}

/**
 * Owns one lv-grid's half of the find widget: the search, marking a match current, and
 * dropping both when the grid is reshaped under them. `lv-find` is app-wide, so a grid
 * that is not shown answers nothing.
 */
export class LvGridFindController {
  totalMatches = 0;

  private readonly _options: LvGridFindOptions;
  private _query: FindQuery | null = null;
  /** Goes up with each search, so an older one sees it is stale. */
  private _searches = 0;

  constructor(host: ReactiveControllerHost, options: LvGridFindOptions) {
    this._options = options;
    new DomListenerController<FindEventMap>(host, document, {
      'lv-find': (e) => void this.find(e),
      'lv-find-close': (e) => void this.find(e),
    });
  }

  async find(e: CustomEvent<FindEventDetail>): Promise<void> {
    const grid = this._options.grid();
    if (!grid || (!grid.clientHeight && !this.totalMatches)) {
      return;
    }
    if (e.type === 'lv-find-close') {
      this._query = null;
      this.totalMatches = 0;
      grid.clearFind();
      return;
    }
    const { text, options } = e.detail;
    if (text === this._query?.text && options.matchCase === this._query.matchCase) {
      return;
    }
    this._query = { text, matchCase: options.matchCase };
    const search = ++this._searches;
    const total = await grid.find(this._query);
    if (search !== this._searches) {
      return;
    }
    if (total < 0) {
      // A rebuild dropped it: show no matches and forget the query, so the next Enter searches.
      this.clear();
      return;
    }
    this.totalMatches = total;
    this._options.report(total);
  }

  /** Marks match `index` current, counted from 1 as the widget counts; 0 marks none. */
  async highlight(index: number): Promise<void> {
    const grid = this._options.grid();
    if (grid?.clientHeight) {
      await grid.setCurrentMatch(index - 1);
    }
  }

  /** Drops the search, in the grid and in the widget. */
  clear(): void {
    this._query = null;
    this.totalMatches = 0;
    this._options.grid()?.clearFind();
    this._options.report(0);
  }

  /** A sort or column change moves the matches, so their numbers no longer hold. */
  dropOnReshape(): void {
    if (this.totalMatches > 0) {
      this.clear();
    }
  }
}
