/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * SearchCursorImpl
 *
 * Stateful cursor for navigating search results.
 * Provides array-like access with seek navigation.
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
    // None is current until a step: a search alone does not move the reader.
    this._currentIndex = -1;
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

  seek(index: number): SearchMatch<E> | null {
    if (index === -1) {
      this._currentIndex = -1;
      return null;
    }
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

  getMatchedEventIds(): ReadonlySet<string> {
    return (this._matchedEventIds ??= new Set(this._matches.map((m) => m.rect.id)));
  }

  /**
   * Both memos hold for the life of the cursor, which needs `_matches` to be the caller's
   * last word on the match set. `buildMatchIndex` also keys its cache on this array, so it
   * must stay the same one.
   */
  getMatchedEventsInfo(): ReadonlyArray<MatchedEventInfo> {
    return (this._matchedEventsInfo ??= this._matches.map((m) => ({
      timestamp: m.rect.timeStart,
      duration: m.rect.duration,
      depth: m.depth,
      category: m.rect.category,
    })));
  }
}
