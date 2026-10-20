/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ReactiveControllerHost } from 'lit';

import { DomListenerController } from '../../core/events/DomListenerController.js';
import type { FindEventDetail, FindEventMap } from '../../features/find/findEvents.js';
import type { FindQuery, GridFindDetail, LvGrid } from '../../grid/index.js';

/** The part of an lv-grid that find drives. */
export type FindableGrid = Pick<LvGrid, 'find' | 'setCurrentMatch' | 'clearFind'>;

type Found = (GridFindDetail & { grid: FindableGrid })[];

export interface LvGridFindOptions {
  /**
   * The grids to search, in the order the widget counts their matches. Read late: grids
   * are made well after the host connects. Folded grids are searched too.
   */
  grids: () => readonly FindableGrid[];
  /** Shows a folded grid before a step marks a match in it. Give it if the host can fold one. */
  unfold?: (grid: FindableGrid) => Promise<void>;
}

/**
 * The find widget's search over a host's lv-grids: it searches, reports the total in
 * `lv-find-results`, marks the widget's current match in the grid that holds it, and
 * searches again when a grid is reshaped under it. A host off screen answers nothing,
 * which keeps the hidden tabs quiet, but keeps the query to search once shown.
 */
export class LvGridFindController {
  private readonly _host: HTMLElement;
  private readonly _options: LvGridFindOptions;
  private _query: FindQuery | null = null;
  // The grids the last search ran over, with each one's count.
  private _found: Found = [];
  // Goes up with each search and clear, so an older search sees it is stale.
  private _searches = 0;
  // A move to a match is ignored while these run: it would count by the totals they replace.
  private _reruns = 0;
  // Goes up with each step, so a step that waited on an unfold sees a newer one replaced it.
  private _steps = 0;

  constructor(host: ReactiveControllerHost & HTMLElement, options: LvGridFindOptions) {
    this._host = host;
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
        await this._step(count);
      }
      return;
    }
    this._query = query;
    if (!(await this._search(query, shown))) {
      return;
    }
    report(this.totalMatches, count ? Math.min(1, this.totalMatches) : 0);
    await this._step(count);
  }

  /** Drops the search in the grids, and in the widget while the host is on screen. */
  clear(): void {
    this._drop();
    if (this._shown().length) {
      report(0, 0);
    }
  }

  /**
   * Searches again after a sort, filter, grouping or view switch moved the matches, and
   * reports the new total with the current match kept on its row, or none when that row
   * has no match now. A kept match out of view scrolls into it. Call it once the grids to
   * search are rendered. A host off screen clears its marks, and keeps the query.
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
    this._reruns++;
    const found = await this._search(query, shown).finally(() => this._reruns--);
    if (!found) {
      return;
    }
    const currentMatch = currentMatchOf(found);
    report(this.totalMatches, currentMatch);
    if (currentMatch) {
      await this._markCurrent(currentMatch);
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

  // A move to match `count`: unfolds the grid that holds it, then marks it.
  private async _step(count: number): Promise<void> {
    const step = ++this._steps;
    const search = this._searches;
    const holder = holderOf(this._found, count);
    if (holder && this._options.unfold) {
      await this._options.unfold(holder);
      if (step !== this._steps || search !== this._searches) {
        return;
      }
    }
    await this._markCurrent(count);
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

  private _shown(): readonly FindableGrid[] {
    return this._host.clientHeight > 0 ? this._options.grids() : [];
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

/** The grid that holds match `count`, from 1 across the grids. */
function holderOf(found: Found, count: number): FindableGrid | undefined {
  let before = 0;
  for (const { grid, total } of found) {
    if (count - before <= total) {
      return count > before ? grid : undefined;
    }
    before += total;
  }
  return undefined;
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
