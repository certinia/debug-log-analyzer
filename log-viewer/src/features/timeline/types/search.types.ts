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
 * Lightweight info about a matched event for bucket search highlighting.
 * Used instead of full SearchMatch to avoid exposing event details to renderers.
 */
export interface MatchedEventInfo {
  /** Event start time in nanoseconds */
  timestamp: number;
  /** Event duration in nanoseconds */
  duration: number;
  /** Depth in the event tree (0-indexed) */
  depth: number;
  /** Event subcategory for color resolution */
  category: string;
}

/**
 * Represents a single search match with rendering data.
 */
export interface SearchMatch<E extends EventNode> {
  /** The matched event */
  readonly event: E;

  /** The matched frame's id, as `event.id` */
  readonly id: string;

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
  /** All search matches in traversal order */
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
  /** Get set of matched event IDs for desaturation rendering */
  getMatchedEventIds(): ReadonlySet<string>;

  /** Get lightweight info about matched events for bucket search highlighting */
  getMatchedEventsInfo(): ReadonlyArray<MatchedEventInfo>;
}
