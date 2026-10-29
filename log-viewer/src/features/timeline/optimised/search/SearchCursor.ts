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
import type { RowSet, SearchCursor, SearchMatch } from '../../types/search.types.js';

// A byte per row up to the last match: a search can match every frame of a log.
class RowBitmap implements RowSet {
  readonly size: number;
  private readonly bits: Uint8Array;

  /** `matches` are unique and ascending by row, as `EventMatcher.scan` gives them. */
  constructor(matches: ReadonlyArray<{ row: number }>) {
    this.bits = new Uint8Array((matches.at(-1)?.row ?? -1) + 1);
    for (const { row } of matches) {
      this.bits[row] = 1;
    }
    this.size = matches.length;
  }

  has(row: number): boolean {
    return this.bits[row] === 1;
  }
}

export class SearchCursorImpl<E extends EventNode> implements SearchCursor<E> {
  private _currentIndex: number;
  private readonly _matches: SearchMatch<E>[];
  private _matchedRows: RowSet | null = null;

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

  /** Memoised: `_matches` never changes after construction. */
  getMatchedRows(): RowSet {
    return (this._matchedRows ??= new RowBitmap(this._matches));
  }
}
