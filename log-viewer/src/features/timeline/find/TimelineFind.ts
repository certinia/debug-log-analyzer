/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { FindQuery, GridFindDetail } from '../../../grid/index.js';
import type { FindTarget } from '../../find/FindController.js';
import type { FlameChart } from '../optimised/FlameChart.js';
import { textPredicate } from '../optimised/search/EventMatcher.js';
import type { EventNode } from '../types/flamechart.types.js';
import type { SearchCursor } from '../types/search.types.js';

/** The part of the chart find drives. */
export type FindableChart<E extends EventNode> = Pick<
  FlameChart<E>,
  'search' | 'clearSearch' | 'requestRender'
>;

/**
 * The Timeline's frames as a find target. A new query marks its matches with none current;
 * the same query again keeps the current one. A step centres the chart on its frame.
 */
export class TimelineFind<E extends EventNode> implements FindTarget {
  private readonly chart: FindableChart<E>;
  private readonly onClear: () => void;
  private cursor: SearchCursor<E> | null = null;
  private query: FindQuery | null = null;

  /** @param onClear - Runs when the search is dropped, as for the panel a step opened. */
  constructor(chart: FindableChart<E>, onClear: () => void) {
    this.chart = chart;
    this.onClear = onClear;
  }

  async find(query: FindQuery): Promise<GridFindDetail> {
    const { cursor } = this;
    if (cursor && query.text === this.query?.text && query.matchCase === this.query.matchCase) {
      return { total: cursor.total, current: cursor.currentIndex };
    }
    this.clearFind();
    if (!query.text) {
      return { total: 0, current: -1 };
    }
    this.query = query;
    this.cursor = this.chart.search(textPredicate(query.text, query.matchCase));
    return { total: this.cursor?.total ?? 0, current: -1 };
  }

  async setCurrentMatch(match: number): Promise<void> {
    const cursor = this.cursor;
    if (!cursor) {
      return;
    }
    const had = cursor.currentIndex >= 0;
    cursor.seek(match);
    if (match < 0 && had) {
      this.chart.requestRender();
    }
  }

  clearFind(): void {
    if (!this.query) {
      return;
    }
    this.cursor = null;
    this.query = null;
    this.chart.clearSearch();
    this.onClear();
  }
}
