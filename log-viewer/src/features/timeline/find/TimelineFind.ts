/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { FindCount, FindQuery, FindTarget } from '../../find/FindController.js';
import type { FlameChart } from '../optimised/FlameChart.js';
import { textPredicate } from '../optimised/search/EventMatcher.js';
import type { EventNode } from '../types/flamechart.types.js';

/** The part of the chart find drives. The chart's search owns the matches and the current one. */
export type FindableChart<E extends EventNode> = Pick<
  FlameChart<E>,
  'search' | 'setCurrentMatch' | 'getSearchCursor' | 'clearSearch' | 'getViewportBounds'
>;

/** The Timeline's frames as a find target. A step centres the chart on its frame. */
export class TimelineFind<E extends EventNode> implements FindTarget {
  private readonly chart: FindableChart<E>;
  private readonly onClear: () => void;
  private query: FindQuery | null = null;

  /** @param onClear - Runs when the search is dropped, as for the panel a step opened. */
  constructor(chart: FindableChart<E>, onClear: () => void) {
    this.chart = chart;
    this.onClear = onClear;
  }

  async find(query: FindQuery): Promise<FindCount | null> {
    const cursor = this.chart.getSearchCursor();
    if (cursor && query.text === this.query?.text && query.matchCase === this.query.matchCase) {
      return { total: cursor.total, current: cursor.currentIndex };
    }
    this.clearFind();
    if (!query.text) {
      return { total: 0, current: -1 };
    }
    this.query = query;
    const total = await this.chart.search(textPredicate(query.text, query.matchCase));
    return total === null ? null : { total, current: -1 };
  }

  // A kept match leaves the chart still: a step clears the selection and centres the chart.
  async setCurrentMatch(match: number, kept = false): Promise<void> {
    const current = this.chart.getSearchCursor()?.currentIndex ?? -1;
    if (this.query && !kept && !(match < 0 && current < 0)) {
      this.chart.setCurrentMatch(match);
    }
  }

  nearView(direction: 'next' | 'prev'): number {
    const matches = this.chart.getSearchCursor()?.matches;
    const bounds = this.chart.getViewportBounds();
    if (!this.query || !matches?.length || !bounds) {
      return -1;
    }
    // By start, not overlap: a parent that spans the view, such as the root, would pull every step back to it.
    if (direction === 'next') {
      const match = firstStartingFrom(matches, bounds.timeStart);
      return match < matches.length ? match : -1;
    }
    return firstStartingFrom(matches, bounds.timeEnd) - 1;
  }

  clearFind(): void {
    if (!this.query) {
      return;
    }
    this.query = null;
    this.chart.clearSearch();
    this.onClear();
  }
}

// The matches are in log order, which is by start time.
function firstStartingFrom(
  matches: readonly { rect: { timeStart: number } }[],
  time: number,
): number {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((matches[mid]?.rect.timeStart ?? Infinity) < time) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
