/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Search-related type definitions for timeline search functionality.
 *
 * Provides generic interfaces for search matches and cursor navigation,
 * decoupled from specific event implementations.
 */

import type { EventNode } from './flamechart.types.js';

/** Tests a frame by its text and type, so a search reads strings rather than nodes. */
export type FramePredicate = (text: string, type: string) => boolean;

/**
 * Where a matched frame sits, for bucket search highlighting. A search match and a
 * rect both are one, so neither is copied into another object.
 */
export interface MatchSpan {
  /** Start time in nanoseconds */
  readonly timeStart: number;
  /** Depth in the event tree (0-indexed) */
  readonly depth: number;
  /** Category, for colour */
  readonly category: string;
}

/** A set of frames by row, as a search or an emphasis holds them. */
export interface RowSet {
  readonly size: number;
  has(row: number): boolean;
}

/**
 * Represents a single search match with rendering data.
 */
export interface SearchMatch<E extends EventNode> {
  /** The matched event */
  readonly event: E;

  /** The matched frame's row */
  readonly row: number;

  /** Start time in nanoseconds */
  readonly timeStart: number;

  /** Duration in nanoseconds */
  readonly duration: number;

  /** Category, for colour */
  readonly category: string;

  /** Depth in the event tree (0-indexed) */
  readonly depth: number;

  /** Type of match (text content or event type) */
  readonly matchType: 'text' | 'type';
}

/**
 * Cursor for navigating search results with stateful position tracking.
 *
 * Provides array-like access to matches with navigation methods
 * for moving between results. The cursor maintains current position
 * and supports random access via seek().
 */
export interface SearchCursor<E extends EventNode> {
  // State (readonly)
  /** All search matches in traversal order; the same array for the cursor's life, as renderers cache on it */
  readonly matches: ReadonlyArray<SearchMatch<E>>;

  /** Current position in matches array (0-indexed), -1 until a step moves to one */
  readonly currentIndex: number;

  /** Total number of matches */
  readonly total: number;

  // Navigation methods
  /** Seek to specific index, returns match or null if out of bounds; -1 makes none current */
  seek(index: number): SearchMatch<E> | null;

  // Query methods
  /** Get current match without moving cursor */
  getCurrent(): SearchMatch<E> | null;

  // Rendering support
  /** The matched rows, for desaturation rendering; the same set on every call */
  getMatchedRows(): RowSet;
}
