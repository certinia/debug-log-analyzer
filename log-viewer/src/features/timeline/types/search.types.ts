/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Search-related type definitions for timeline search functionality.
 *
 * Provides generic interfaces for search matches, cursor navigation,
 * and search options, decoupled from specific event implementations.
 */

import type { PrecomputedRect } from '../optimised/RectangleManager.js';
import type { EventNode } from './flamechart.types.js';

/**
 * Represents a single search match with rendering data.
 */
export interface SearchMatch<E extends EventNode> {
  /** The matched event */
  event: E;

  /** Pre-computed rectangle for rendering */
  rect: PrecomputedRect;

  /** Depth in the event tree (0-indexed) */
  depth: number;

  /** Type of match (text content or event type) */
  matchType: 'text' | 'type';
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
  /** All search matches in traversal order */
  readonly matches: ReadonlyArray<SearchMatch<E>>;

  /** Current position in matches array (0-indexed, -1 if empty) */
  readonly currentIndex: number;

  /** Total number of matches */
  readonly total: number;

  // Navigation methods
  /** Move to next match, returns match or null if at end */
  next(): SearchMatch<E> | null;

  /** Move to previous match, returns match or null if at start */
  prev(): SearchMatch<E> | null;

  /** Jump to first match, returns match or null if empty */
  first(): SearchMatch<E> | null;

  /** Jump to last match, returns match or null if empty */
  last(): SearchMatch<E> | null;

  /** Seek to specific index, returns match or null if out of bounds */
  seek(index: number): SearchMatch<E> | null;

  // Query methods
  /** Get current match without moving cursor */
  getCurrent(): SearchMatch<E> | null;

  /** Check if there's a next match */
  hasNext(): boolean;

  /** Check if there's a previous match */
  hasPrev(): boolean;

  // Rendering support
  /** Get set of matched event IDs for desaturation rendering */
  getMatchedEventIds(): ReadonlySet<string>;
}

/**
 * Options for search behavior.
 */
export interface SearchOptions {
  /** Enable case-sensitive search (default: false) */
  caseSensitive?: boolean;

  /** Match whole words only (default: false) */
  matchWholeWord?: boolean;
}
