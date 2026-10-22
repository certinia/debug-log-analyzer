/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { firstIndexWhere } from '../../../core/utility/Util.js';
import type { FindCount, FindQuery, FindTarget } from '../../find/FindController.js';
import type { FindDirection } from '../../find/findEvents.js';
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
  // The query the cursor belongs to: while a new one scans, the cursor still holds the old matches.
  private searched: FindQuery | null = null;

  /** @param onClear - Runs when the search is dropped, as for the panel a step opened. */
  constructor(chart: FindableChart<E>, onClear: () => void) {
    this.chart = chart;
    this.onClear = onClear;
  }

  async find(query: FindQuery): Promise<FindCount | null> {
    const cursor = this.chart.getSearchCursor();
    if (
      cursor &&
      query.text === this.searched?.text &&
      query.matchCase === this.searched.matchCase
    ) {
      return { total: cursor.total, current: cursor.currentIndex };
    }
    if (!query.text) {
      this.clearFind();
      return { total: 0, current: -1 };
    }
    // The old matches stay lit until the new ones replace them: a clear first flashes the chart unlit.
    if (this.query) {
      this.onClear();
    }
    this.query = query;
    this.searched = null;
    const total = await this.chart.search(textPredicate(query.text, query.matchCase));
    if (total === null) {
      return null;
    }
    this.searched = query;
    return { total, current: -1 };
  }

  // A kept match leaves the chart still: a step clears the selection and centres the chart.
  async setCurrentMatch(match: number, kept = false): Promise<void> {
    const current = this.chart.getSearchCursor()?.currentIndex ?? -1;
    if (this.query && !kept && !(match < 0 && current < 0)) {
      this.chart.setCurrentMatch(match);
    }
  }

  nearView(direction: FindDirection): number {
    const matches = this.chart.getSearchCursor()?.matches;
    const bounds = this.chart.getViewportBounds();
    if (!this.searched || !matches?.length || !bounds) {
      return -1;
    }
    // By start, which log order sorts by, not overlap: a parent that spans the view, such as the root, would pull every step back to it.
    const firstFrom = (time: number): number =>
      firstIndexWhere(matches.length, (i) => (matches[i]?.rect.timeStart ?? Infinity) >= time);
    if (direction === 'next') {
      const match = firstFrom(bounds.timeStart);
      return match < matches.length ? match : -1;
    }
    return firstFrom(bounds.timeEnd) - 1;
  }

  clearFind(): void {
    if (!this.query) {
      return;
    }
    this.query = null;
    this.searched = null;
    this.chart.clearSearch();
    this.onClear();
  }
}
