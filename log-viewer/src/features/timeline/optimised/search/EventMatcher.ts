/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * EventMatcher
 *
 * Generic event searcher for timeline events.
 * Decoupled from ApexEvent-specific implementation, works with any EventNode type.
 *
 * Responsibilities:
 * - Scan the shown frames in pre-order
 * - Apply predicate function to find matches
 * - Build SearchCursor with matched events and rendering data
 * - Track current search state
 */

import { CHECK_EVERY, frameBudget, type Tick } from '#core/utility/FrameBudget.js';
import { type EventNode, rectCategory, type TimelineFrames } from '../../types/flamechart.types.js';
import type { FramePredicate, SearchCursor, SearchMatch } from '../../types/search.types.js';
import { SearchCursorImpl } from './SearchCursor.js';

export class EventMatcher<E extends EventNode> {
  private currentCursor?: SearchCursorImpl<E>;
  private running?: AbortController;
  private frames: TimelineFrames<E>;

  constructor(frames: TimelineFrames<E>) {
    this.frames = frames;
  }

  /**
   * Search events using predicate function, a slice at a time. A newer search or a clear
   * stops it, and it then gives null.
   *
   * @param predicate - Function to test each event
   * @returns The cursor, or null when a newer search or a clear stopped it
   */
  async search(predicate: FramePredicate): Promise<SearchCursor<E> | null> {
    this.running?.abort();
    const running = new AbortController();
    this.running = running;
    const matches = await this.scan(predicate, frameBudget({ signal: running.signal }));
    if (!matches || running.signal.aborted) {
      return null;
    }
    this.running = undefined;
    this.currentCursor = new SearchCursorImpl(matches);
    return this.currentCursor;
  }

  /**
   * Clear current search and reset cursor.
   */
  clear(): void {
    this.running?.abort();
    this.running = undefined;
    this.currentCursor = undefined;
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
  private async scan(predicate: FramePredicate, tick: Tick): Promise<SearchMatch<E>[] | null> {
    const frames = this.frames;
    const matches: SearchMatch<E>[] = [];
    let checked = 0;
    for (let row = 0; row < frames.rowCount;) {
      if (++checked % CHECK_EVERY === 0 && !(await tick())) {
        return null;
      }
      if (!frames.isVisible(row)) {
        row = frames.subtreeEnd[row]!;
        continue;
      }
      if (frames.hasRect(row) && predicate(frames.text(row), frames.type(row))) {
        matches.push(new RowMatch(frames, row));
      }
      row++;
    }
    return matches;
  }
}

/** A predicate for frames whose text or type holds `searchText`. */
export function textPredicate(searchText: string, caseSensitive = false): FramePredicate {
  const needle = caseSensitive ? searchText : searchText.toLowerCase();
  const typeHits = new Map<string, boolean>();
  return (text, type) => {
    let typeHit = typeHits.get(type);
    if (typeHit === undefined) {
      typeHit = (caseSensitive ? type : type.toLowerCase()).includes(needle);
      typeHits.set(type, typeHit);
    }
    return typeHit || (caseSensitive ? text : text.toLowerCase()).includes(needle);
  };
}

// Builds its event only when asked: a search can match a hundred thousand frames.
class RowMatch<E extends EventNode> implements SearchMatch<E> {
  private readonly frames: TimelineFrames<E>;
  private readonly row: number;
  private built?: E;

  constructor(frames: TimelineFrames<E>, row: number) {
    this.frames = frames;
    this.row = row;
  }

  get id(): string {
    return String(this.row);
  }

  get timeStart(): number {
    return this.frames.start[this.row]!;
  }

  get duration(): number {
    return this.frames.total[this.row]!;
  }

  get category(): string {
    return rectCategory(this.frames, this.row);
  }

  get depth(): number {
    return this.frames.depth[this.row]!;
  }

  get matchType(): 'text' {
    return 'text';
  }

  get event(): E {
    return (this.built ??= this.frames.node(this.row).data);
  }
}
