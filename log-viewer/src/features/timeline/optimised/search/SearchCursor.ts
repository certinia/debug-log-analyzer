/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchCursorImpl
 *
 * Stateful cursor for navigating search results.
 * Provides array-like access with next/prev/first/last navigation.
 */

import type { EventNode } from '../../types/flamechart.types.js';
import type { MatchedEventInfo, SearchCursor, SearchMatch } from '../../types/search.types.js';

export class SearchCursorImpl<E extends EventNode> implements SearchCursor<E> {
  private _currentIndex: number;
  private readonly _matches: SearchMatch<E>[];
  private _matchedEventIds: ReadonlySet<string> | null = null;
  private _matchedEventsInfo: ReadonlyArray<MatchedEventInfo> | null = null;

  constructor(matches: SearchMatch<E>[]) {
    this._matches = matches;
    this._currentIndex = matches.length > 0 ? 0 : -1;
  }

  get matches(): ReadonlyArray<SearchMatch<E>> {
    return this._matches;
  }

  get currentIndex(): number {
    return this._currentIndex;
  }

  get total(): number {
    return this._matches.length;
  }

  next(): SearchMatch<E> | null {
    if (this._currentIndex < this._matches.length - 1) {
      this._currentIndex++;
      return this._matches[this._currentIndex] ?? null;
    }
    return null;
  }

  prev(): SearchMatch<E> | null {
    if (this._currentIndex > 0) {
      this._currentIndex--;
      return this._matches[this._currentIndex] ?? null;
    }
    return null;
  }

  first(): SearchMatch<E> | null {
    if (this._matches.length > 0) {
      this._currentIndex = 0;
      return this._matches[0] ?? null;
    }
    return null;
  }

  last(): SearchMatch<E> | null {
    if (this._matches.length > 0) {
      this._currentIndex = this._matches.length - 1;
      return this._matches[this._currentIndex] ?? null;
    }
    return null;
  }

  seek(index: number): SearchMatch<E> | null {
    if (index >= 0 && index < this._matches.length) {
      this._currentIndex = index;
      return this._matches[index] ?? null;
    }
    return null;
  }

  getCurrent(): SearchMatch<E> | null {
    if (this._currentIndex >= 0 && this._currentIndex < this._matches.length) {
      return this._matches[this._currentIndex] ?? null;
    }
    return null;
  }

  hasNext(): boolean {
    return this._currentIndex < this._matches.length - 1;
  }

  hasPrev(): boolean {
    return this._currentIndex > 0;
  }

  getMatchedEventIds(): ReadonlySet<string> {
    return (this._matchedEventIds ??= new Set(this._matches.map((m) => m.event.id)));
  }

  /**
   * Both memos hold for the life of the cursor, which needs `_matches` to be the caller's
   * last word on the match set. `buildMatchIndex` also keys its cache on this array, so it
   * must stay the same one.
   */
  getMatchedEventsInfo(): ReadonlyArray<MatchedEventInfo> {
    return (this._matchedEventsInfo ??= this._matches.map((m) => ({
      timestamp: m.event.timestamp,
      duration: m.event.duration ?? 0,
      depth: m.depth,
      category: m.rect.category,
    })));
  }
}
