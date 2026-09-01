/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';

import type { SelectionView } from '../events/EventBus.js';
import { getEventKey, getStackKey } from './eventKeys.js';

/** The path every chain starts from, which no row stands for. */
export const ROOT_PATH_ID = 0;

/**
 * The interned keys and bucket paths of one log.
 *
 * A row in a view whose rows merge occurrences is named by the bucket keys that
 * reach it, since one method holds a row under every caller it has. Joining
 * those keys into a string is what named it before, and the join was the whole
 * cost of a mark. An id per distinct path bounds the table by the tree rather
 * than by the calls, and makes matching an integer test.
 *
 * One invariant holds it together: a row's id is the interned chain of the
 * frames the row holds. {@link pathIdsOf} names the rows a frame belongs to and
 * {@link chainReaches} asks whether a frame's chain runs through one, so the two
 * chain directions stay separate spaces here rather than in every caller.
 *
 * One table per log, held by `LogStore`: an id means nothing to another log.
 */
export class KeyPathIds {
  private keyIds = new Map<string, number>();
  private keys: string[] = [];
  /** Each event's bucket key, as `id + 1` so an unset slot reads as 0. */
  private keyOfEvent: Int32Array;
  private stackIds = new Map<string, number>();
  /** Each bucket key's stack key. A bucket key holds the stack key, so this is
   *  per signature rather than per event. */
  private stackOfKey: number[] = [];
  // Indexed by path id: the paths reachable from it, its own parent, and the key
  // it was minted with. Index 0 is the empty path.
  private children: Array<Map<number, number> | undefined> = [new Map()];
  private parents: number[] = [ROOT_PATH_ID];
  private keyOf: number[] = [-1];
  /** One frame's chain, reused: {@link pathIdsOf} never yields, so one is enough.
   *  Per table rather than per module, so two logs cannot share the buffer. */
  private chain: number[] = [];

  constructor(eventCount: number) {
    this.keyOfEvent = new Int32Array(eventCount);
  }

  /**
   * The event's interned bucket key, kept per event: a mark reads the same
   * ancestors once per occurrence it names.
   */
  public keyIdOf(event: LogEvent): number {
    const at = event.eventIndex;
    // A frame the log's own index has no slot for is keyed but not kept. A frame
    // built rather than parsed has no index at all, and that writes an ordinary
    // property on the typed array, which every other such frame reads as its own.
    const slotted = at >= 0 && at < this.keyOfEvent.length;
    if (slotted) {
      const cached = this.keyOfEvent[at]!;
      if (cached) {
        return cached - 1;
      }
    }
    const id = this.keyId(getEventKey(event));
    if (slotted) {
      this.keyOfEvent[at] = id + 1;
    }
    return id;
  }

  /**
   * The event's interned stack key, which tells a recursive call from a fresh
   * one. Its own space: a stack key is never a step in a path.
   */
  public stackIdOf(event: LogEvent, keyId = this.keyIdOf(event)): number {
    let id = this.stackOfKey[keyId];
    if (id === undefined) {
      const key = getStackKey(event);
      id = this.stackIds.get(key) ?? this.stackIds.size;
      this.stackIds.set(key, id);
      this.stackOfKey[keyId] = id;
    }
    return id;
  }

  /**
   * The ids naming the rows a frame belongs to in a merged view, added to `into`.
   *
   * A top-down row sits at the frame's own depth, so one id names it. A
   * bottom-up row is the frame plus however many of its callers the chain shows,
   * so every prefix names a row the frame heads — which is why one frame marks
   * several rows there.
   *
   * The log root heads no row in either view, so the walk stops below it.
   */
  public pathIdsOf(event: LogEvent, direction: SelectionView, into: Set<number>): void {
    if (!event.parent) {
      return;
    }
    if (direction === 'callers') {
      // The parent walk is already innermost first, which is the order these ids
      // compose in, so nothing is collected on the way.
      let id = ROOT_PATH_ID;
      for (let node: LogEvent | null = event; node?.parent; node = node.parent) {
        id = this.step(id, this.keyIdOf(node));
        into.add(id);
      }
      return;
    }
    const chain = this.chain;
    chain.length = 0;
    for (let node: LogEvent | null = event; node?.parent; node = node.parent) {
      chain.push(this.keyIdOf(node));
    }
    let id = ROOT_PATH_ID;
    for (let depth = chain.length - 1; depth >= 0; depth--) {
      id = this.step(id, chain[depth]!);
    }
    into.add(id);
  }

  /**
   * True where the frame's own chain of callers runs through `pathId`: what tells
   * the calls a bottom-up caller row holds from the rest of its bucket's.
   *
   * Reads without minting, unlike {@link step}: a query that grew the table would
   * leave a node behind for every frame it was asked about. Ids only rise as a
   * chain deepens, so the walk stops once it passes the depth asked about.
   */
  public chainReaches(event: LogEvent, pathId: number): boolean {
    let id = ROOT_PATH_ID;
    for (let node: LogEvent | null = event; node?.parent; node = node.parent) {
      const next = this.children[id]?.get(this.keyIdOf(node));
      if (next === undefined || next > pathId) {
        // Never minted, so no row stands for it; or past the row's own depth.
        return false;
      }
      id = next;
      if (id === pathId) {
        return true;
      }
    }
    return false;
  }

  /**
   * The id for the path that reaches an interned key through `parentPathId`,
   * minted on first use. For a walk that already holds the key's id and composes
   * a path as it goes.
   *
   * @param parentPathId - {@link ROOT_PATH_ID} for the outermost key of a chain
   */
  public step(parentPathId: number, keyId: number): number {
    const reachable = (this.children[parentPathId] ??= new Map());
    let id = reachable.get(keyId);
    if (id === undefined) {
      // Counted off `parents`, which is only ever pushed to: reaching for a path
      // that does not exist leaves `children` with a hole, and an id taken from
      // its length would then part company with the other two.
      id = this.parents.length;
      reachable.set(keyId, id);
      this.children.push(undefined);
      this.parents.push(parentPathId);
      this.keyOf.push(keyId);
    }
    return id;
  }

  /** One bucket key's id, interned. */
  public keyId(key: string): number {
    let id = this.keyIds.get(key);
    if (id === undefined) {
      id = this.keys.length;
      this.keyIds.set(key, id);
      this.keys.push(key);
    }
    return id;
  }

  /** The key an id was minted for, for a row that shows the key it merges. */
  public keyText(keyId: number): string {
    return this.keys[keyId]!;
  }

  /**
   * True where `path` runs through `pathId`: the same path, or one that extends
   * it. An id is minted per parent and key, so running through a path is being
   * that path or a descendant of it.
   *
   * A path is always minted after its parent, so ids fall as the walk climbs and
   * it can stop at the depth asked about rather than at the root.
   */
  public reaches(path: number, pathId: number): boolean {
    let id = path;
    while (id > pathId) {
      id = this.parents[id]!;
    }
    return id === pathId;
  }

  /** How many keys `pathId` stands for: the depth of the row it names, 0 at the
   *  root. */
  public depthOf(pathId: number): number {
    let depth = 0;
    for (let id = pathId; id > ROOT_PATH_ID; id = this.parents[id]!) {
      depth++;
    }
    return depth;
  }

  /**
   * The keys `pathId` stands for, outermost first. For reading a stamped id back
   * while debugging: nothing on a hot path calls it.
   */
  public keysOf(pathId: number): string[] {
    const keys: string[] = [];
    for (let id = pathId; id > ROOT_PATH_ID; id = this.parents[id]!) {
      keys.push(this.keys[this.keyOf[id]!]!);
    }
    return keys.reverse();
  }
}
