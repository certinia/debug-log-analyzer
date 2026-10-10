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
  /**
   * The grids to search, in the order the widget counts their matches. Read late: grids
   * are made well after the host connects. One that is not shown is not searched.
   */
  grids: () => readonly FindableGrid[];
}

/**
 * The find widget's search over a host's lv-grids: it searches, reports the total in
 * `lv-find-results`, marks the widget's current match in the grid that holds it, and
 * drops the search when a grid is reshaped under it. A host with no grid shown answers
 * nothing, which keeps the hidden tabs quiet.
 */
export class LvGridFindController {
  private readonly _options: LvGridFindOptions;
  private _query: FindQuery | null = null;
  /** The grids the last search ran over, with each one's count. */
  private _found: { grid: FindableGrid; total: number }[] = [];
  /** Goes up with each search and clear, so an older search sees it is stale. */
  private _searches = 0;

  constructor(host: ReactiveControllerHost, options: LvGridFindOptions) {
    this._options = options;
    new DomListenerController<FindEventMap>(host, document, {
      'lv-find': (e) => void this.find(e),
      'lv-find-match': (e) => void this.find(e),
      'lv-find-close': (e) => void this.find(e),
    });
  }

  get totalMatches(): number {
    return this._found.reduce((sum, { total }) => sum + total, 0);
  }

  async find(e: CustomEvent<FindEventDetail>): Promise<void> {
    const shown = this._options.grids().filter((grid) => grid.clientHeight > 0);
    if (!shown.length && !this.totalMatches) {
      return;
    }
    if (e.type === 'lv-find-close') {
      this._drop();
      return;
    }
    const { text, options, count } = e.detail;
    if (text !== this._query?.text || options.matchCase !== this._query.matchCase) {
      const query = { text, matchCase: options.matchCase };
      this._query = query;
      const search = ++this._searches;
      const totals: number[] = [];
      for (const grid of shown) {
        totals.push(await grid.find(query));
        if (search !== this._searches) {
          return;
        }
      }
      if (totals.some((total) => total < 0)) {
        // A rebuild dropped it: show no matches and forget the query, so the next Enter searches.
        this.clear();
        return;
      }
      this._found = shown.map((grid, i) => ({ grid, total: totals[i] ?? 0 }));
      report(this.totalMatches);
    }
    await this._markCurrent(count);
  }

  /** Drops the search, in the grids and in the widget. */
  clear(): void {
    this._drop();
    report(0);
  }

  /** A sort, filter, grouping or view switch moves the matches, so their numbers no longer hold. */
  dropOnReshape(): void {
    if (this._query) {
      this.clear();
    }
  }

  /** Marks match `count`, counted from 1 across the grids as the widget counts; 0 marks none. */
  private async _markCurrent(count: number): Promise<void> {
    let before = 0;
    for (const { grid, total } of this._found) {
      const match = count - 1 - before;
      await grid.setCurrentMatch(match >= 0 && match < total ? match : -1);
      before += total;
    }
  }

  private _drop(): void {
    this._searches++;
    this._query = null;
    this._found = [];
    // Every grid, not only those the last search ended on: a stale search marks too.
    for (const grid of this._options.grids()) {
      grid.clearFind();
    }
  }
}

function report(totalMatches: number): void {
  document.dispatchEvent(new CustomEvent('lv-find-results', { detail: { totalMatches } }));
}
