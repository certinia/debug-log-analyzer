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
import type {
  MatchedEventInfo,
  RowSet,
  SearchCursor,
  SearchMatch,
} from '../../types/search.types.js';

// A byte per row up to the last match: a search can match every frame of a log.
class RowBitmap implements RowSet {
  readonly size: number;
  private readonly bits: Uint8Array;

  constructor(matches: ReadonlyArray<{ row: number }>) {
    let last = -1;
    for (const { row } of matches) {
      last = row > last ? row : last;
    }
    this.bits = new Uint8Array(last + 1);
    let size = 0;
    for (const { row } of matches) {
      size += this.bits[row] ? 0 : 1;
      this.bits[row] = 1;
    }
    this.size = size;
  }

  has(row: number): boolean {
    return this.bits[row] === 1;
  }
}

export class SearchCursorImpl<E extends EventNode> implements SearchCursor<E> {
  private _currentIndex: number;
  private readonly _matches: SearchMatch<E>[];
  private _matchedRows: RowSet | null = null;
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

  getMatchedRows(): RowSet {
    return (this._matchedRows ??= new RowBitmap(this._matches));
  }

  /**
   * Both memos hold for the life of the cursor, which needs `_matches` to be the caller's
   * last word on the match set. `buildMatchIndex` also keys its cache on this array, so it
   * must stay the same one.
   */
  getMatchedEventsInfo(): ReadonlyArray<MatchedEventInfo> {
    return (this._matchedEventsInfo ??= this._matches.map((m) => ({
      timestamp: m.timeStart,
      duration: m.duration,
      depth: m.depth,
      category: m.category,
    })));
  }
}
