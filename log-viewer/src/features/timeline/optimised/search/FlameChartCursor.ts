/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * FlameChartCursor - Cursor with automatic side effects
 *
 * Wraps SearchCursor to add automatic centering, rendering, and callback
 * invocation when navigating between matches.
 */

import type { EventNode } from '../../types/flamechart.types.js';
import type { SearchCursor, SearchMatch } from '../../types/search.types.js';

export class FlameChartCursor<E extends EventNode> implements SearchCursor<E> {
  constructor(
    private innerCursor: SearchCursor<E>,
    private onNavigate: (match: SearchMatch<E>) => void,
  ) {}

  get matches(): ReadonlyArray<SearchMatch<E>> {
    return this.innerCursor.matches;
  }

  get currentIndex(): number {
    return this.innerCursor.currentIndex;
  }

  get total(): number {
    return this.innerCursor.total;
  }

  next(): SearchMatch<E> | null {
    const match = this.innerCursor.next();
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  prev(): SearchMatch<E> | null {
    const match = this.innerCursor.prev();
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  first(): SearchMatch<E> | null {
    const match = this.innerCursor.first();
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  last(): SearchMatch<E> | null {
    const match = this.innerCursor.last();
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  seek(index: number): SearchMatch<E> | null {
    const match = this.innerCursor.seek(index);
    if (match) {
      this.onNavigate(match);
    }
    return match;
  }

  getCurrent(): SearchMatch<E> | null {
    return this.innerCursor.getCurrent();
  }

  hasNext(): boolean {
    return this.innerCursor.hasNext();
  }

  hasPrev(): boolean {
    return this.innerCursor.hasPrev();
  }

  getMatchedEventIds(): ReadonlySet<string> {
    return this.innerCursor.getMatchedEventIds();
  }
}
