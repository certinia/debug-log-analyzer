/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * EventMatcher
 *
 * Generic event searcher for timeline events.
 * Decoupled from LogEvent-specific implementation, works with any EventNode type.
 *
 * Responsibilities:
 * - Scan the shown frames in pre-order
 * - Apply predicate function to find matches
 * - Build SearchCursor with matched events and rendering data
 * - Track current search state
 */

import type { EventNode, TimelineFrames } from '../../types/flamechart.types.js';
import type {
  FramePredicate,
  SearchCursor,
  SearchMatch,
  SearchOptions,
} from '../../types/search.types.js';
import { SearchCursorImpl } from './SearchCursor.js';

export class EventMatcher<E extends EventNode> {
  private currentCursor?: SearchCursorImpl<E>;
  private frames: TimelineFrames<E>;

  constructor(frames: TimelineFrames<E>) {
    this.frames = frames;
  }

  /**
   * Search events using predicate function.
   *
   * @param predicate - Function to test each event
   * @param options - Search options (caseSensitive, matchWholeWord)
   * @returns SearchCursor for navigating results
   */
  search(predicate: FramePredicate, _options: SearchOptions = {}): SearchCursor<E> {
    const matches = this.scan(predicate);
    this.currentCursor = new SearchCursorImpl(matches);
    return this.currentCursor;
  }

  /**
   * Clear current search and reset cursor.
   */
  clear(): void {
    this.currentCursor = undefined;
  }

  /**
   * Set the current cursor. Used to restore cursor after it was cleared.
   * @param cursor - The cursor to restore
   */
  setCursor(cursor: SearchCursorImpl<E>): void {
    this.currentCursor = cursor;
  }

  /**
   * Get current search cursor (if any).
   *
   * @returns Current cursor or undefined if no active search
   */
  getCursor(): SearchCursor<E> | undefined {
    return this.currentCursor;
  }

  /**
   * Collect the shown frames that match and have a rect, in pre-order: the order
   * the frames appear in the log.
   */
  private scan(predicate: FramePredicate): SearchMatch<E>[] {
    const frames = this.frames;
    const matches: SearchMatch<E>[] = [];
    for (let row = 0; row < frames.rowCount;) {
      if (!frames.isVisible(row)) {
        row = frames.subtreeEnd[row]!;
        continue;
      }
      const rect = frames.rectOf(row);
      if (rect && predicate(frames.text(row), frames.type(row))) {
        matches.push({
          event: frames.node(row).data,
          rect,
          depth: frames.depth[row]!,
          matchType: 'text',
        });
      }
      row++;
    }
    return matches;
  }
}
