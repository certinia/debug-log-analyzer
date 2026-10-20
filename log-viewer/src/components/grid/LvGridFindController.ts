/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveControllerHost } from 'lit';

import { DomListenerController } from '../../core/events/DomListenerController.js';
import type { FindEventDetail, FindEventMap } from '../../features/find/findEvents.js';
import type { FindQuery, GridFindDetail, LvGrid } from '../../grid/index.js';

/** The part of an lv-grid that find drives. */
export type FindableGrid = Pick<LvGrid, 'find' | 'setCurrentMatch' | 'clearFind' | 'clientHeight'>;

type Found = (GridFindDetail & { grid: FindableGrid })[];

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
 * searches again when a grid is reshaped under it. A host with no grid shown answers
 * nothing, which keeps the hidden tabs quiet, but keeps the query to search once shown.
 */
export class LvGridFindController {
  private readonly _options: LvGridFindOptions;
  private _query: FindQuery | null = null;
  // The grids the last search ran over, with each one's count.
  private _found: Found = [];
  // Goes up with each search and clear, so an older search sees it is stale.
  private _searches = 0;
  // A move to a match is ignored while these run: it would count by the totals they replace.
  private _reruns = 0;

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
    if (e.type === 'lv-find-close') {
      this._drop();
      return;
    }
    const { text, options, count } = e.detail;
    const query = { text, matchCase: options.matchCase };
    const isNew = text !== this._query?.text || options.matchCase !== this._query.matchCase;
    const shown = this._shown();
    // A hidden host answers nothing, but keeps the query, so it searches once shown.
    if (!shown.length) {
      if (isNew) {
        this._forget();
        this._query = query;
      }
      return;
    }
    if (!isNew) {
      if (e.type === 'lv-find') {
        await this.rerun();
      } else if (!this._reruns) {
        await this._markCurrent(count);
      }
      return;
    }
    this._query = query;
    if (!(await this._search(query, shown))) {
      return;
    }
    report(this.totalMatches, count ? Math.min(1, this.totalMatches) : 0);
    await this._markCurrent(count);
  }

  /** Drops the search in the grids, and in the widget while a grid is shown. */
  clear(): void {
    this._drop();
    if (this._shown().length) {
      report(0, 0);
    }
  }

  /**
   * Searches again after a sort, filter, grouping or view switch moved the matches, and
   * reports the new total with the current match kept on its row, or none when that row
   * has no match now. Neither scrolls nor opens a row. Call it once the grids to search
   * are rendered. A host with no grid shown clears its marks, and keeps the query.
   */
  async rerun(): Promise<void> {
    const query = this._query;
    if (!query) {
      return;
    }
    const shown = this._shown();
    if (!shown.length) {
      this._forget();
      return;
    }
    this._options
      .grids()
      .filter((grid) => !shown.includes(grid))
      .forEach((grid) => grid.clearFind());
    this._reruns++;
    const found = await this._search(query, shown).finally(() => this._reruns--);
    if (found) {
      report(this.totalMatches, currentMatchOf(found));
    }
  }

  // Null when a newer search replaced this one, or a grid's rebuild did, which clears the search.
  private async _search(query: FindQuery, shown: readonly FindableGrid[]): Promise<Found | null> {
    const search = ++this._searches;
    const found: Found = [];
    for (const grid of shown) {
      const result = await grid.find(query);
      if (search !== this._searches) {
        return null;
      }
      if (!result) {
        // Forgets the query, so the next Enter searches again.
        this.clear();
        return null;
      }
      found.push({ grid, ...result });
    }
    this._found = found;
    return found;
  }

  // `count` is from 1 across the grids, as the widget counts; 0 marks none.
  private async _markCurrent(count: number): Promise<void> {
    let before = 0;
    for (const { grid, total } of this._found) {
      const match = count - 1 - before;
      await grid.setCurrentMatch(match >= 0 && match < total ? match : -1);
      before += total;
    }
  }

  private _shown(): FindableGrid[] {
    return this._options.grids().filter((grid) => grid.clientHeight > 0);
  }

  private _drop(): void {
    this._query = null;
    this._forget();
  }

  // Clears the grids but keeps the query, as for a host hidden until it searches again.
  private _forget(): void {
    this._searches++;
    this._found = [];
    // Every grid, not only those the last search ended on: it stops a search still running.
    for (const grid of this._options.grids()) {
      grid.clearFind();
    }
  }
}

/** The match a grid holds current, from 1 across the grids, as the widget counts; 0 for none. */
function currentMatchOf(found: Found): number {
  let before = 0;
  for (const { total, current } of found) {
    if (current >= 0) {
      return before + current + 1;
    }
    before += total;
  }
  return 0;
}

function report(totalMatches: number, currentMatch: number): void {
  document.dispatchEvent(
    new CustomEvent('lv-find-results', { detail: { totalMatches, currentMatch } }),
  );
}
