/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Signatures } from './signatures.js';

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
 * frames the row holds. {@link pathIdOf} and {@link pathsEndingIn} name the rows
 * a frame stands for, one direction each, and {@link chainNodeAt} reads a row's
 * own frame back out of a chain.
 *
 * One table per log, held by `LogStore`: an id means nothing to another log.
 */
export class KeyPathIds {
  private keyIds = new Map<string, number>();
  private keys: string[] = [];
  private readonly signatures: Signatures;
  private readonly frameAbove: (id: number) => number;
  /** Each signature's bucket key id. */
  private keyOfSignature: number[] = [];
  // Indexed by path id: the paths reachable from it, its own parent, and the key
  // it was minted with. Index 0 is the empty path.
  private children: Array<Map<number, number> | undefined> = [new Map()];
  private parents: number[] = [ROOT_PATH_ID];
  private keyOf: number[] = [-1];
  /** The paths each key heads, which is how a frame finds the rows it stands
   *  for. Filled as paths are minted, so the answer costs what it holds. */
  private pathsByKey: number[][] = [];
  /** One frame's chain, reused: {@link pathIdOf} never yields, so one is enough.
   *  Per table rather than per module, so two logs cannot share the buffer. */
  private chain: number[] = [];

  /**
   * @param signatures - the log's signature table, which names each event's key
   * @param parentOf - the shown frame above an event id, 0 at the top of the log
   */
  constructor(signatures: Signatures, parentOf: (id: number) => number) {
    this.signatures = signatures;
    this.frameAbove = parentOf;
  }

  /** Event `id`'s interned bucket key: one string per signature, built once. */
  public keyIdOf(id: number): number {
    const signature = this.signatures.of(id);
    const cached = this.keyOfSignature[signature];
    if (cached !== undefined) {
      return cached;
    }
    const keyId = this.keyId(this.signatures.key(signature));
    this.keyOfSignature[signature] = keyId;
    return keyId;
  }

  /**
   * Event `id`'s interned stack key, which tells a recursive call from a fresh
   * one. Its own space: a stack key is never a step in a path.
   */
  public stackIdOf(id: number): number {
    return this.signatures.stackOf(this.signatures.of(id));
  }

  /**
   * The id naming the row event `eventId` sits in, top-down, or undefined for the log
   * itself (id 0), which heads no row.
   */
  public pathIdOf(eventId: number): number | undefined {
    if (eventId <= 0) {
      return undefined;
    }
    const chain = this.chain;
    chain.length = 0;
    for (let node = eventId; node > 0; node = this.frameAbove(node)) {
      chain.push(this.keyIdOf(node));
    }
    let id = ROOT_PATH_ID;
    for (let depth = chain.length - 1; depth >= 0; depth--) {
      id = this.step(id, chain[depth]!);
    }
    return id;
  }

  /**
   * The paths whose own key is one of `keyIds`: the rows that stand for those
   * frames in a bottom-up view, wherever they sit.
   *
   * A bottom-up row is the frame at its own depth, so a frame heads the bucket
   * for it and any caller row for it under another bucket. The chains above it
   * are other frames' rows, which is why they are not here.
   */
  public pathsEndingIn(keyIds: ReadonlySet<number>): number[] {
    const found: number[] = [];
    for (const keyId of keyIds) {
      // A path holds one key, so no path is reached twice.
      const paths = this.pathsByKey[keyId];
      if (paths) {
        found.push(...paths);
      }
    }
    return found;
  }

  /**
   * The frame in the chain that `pathId` names, or null where the chain does not
   * run through it: the caller a bottom-up row is, at the depth the row sits at.
   *
   * The walk that decides membership stands on that frame when it gets there, so
   * a caller row's frames come out of it rather than out of a second climb.
   *
   * Reads without minting, unlike {@link step}: a query that grew the table would
   * leave a node behind for every frame it was asked about. Ids only rise as a
   * chain deepens, so the walk stops once it passes the depth asked about.
   *
   * @returns the frame's event id, or 0 for none
   */
  public chainNodeAt(eventId: number, pathId: number): number {
    let id = ROOT_PATH_ID;
    for (let node = eventId; node > 0; node = this.frameAbove(node)) {
      const next = this.children[id]?.get(this.keyIdOf(node));
      if (next === undefined || next > pathId) {
        // Never minted, so no row stands for it; or past the row's own depth.
        return 0;
      }
      id = next;
      if (id === pathId) {
        return node;
      }
    }
    return 0;
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
      (this.pathsByKey[keyId] ??= []).push(id);
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

  /** The path `pathId` extends, {@link ROOT_PATH_ID} for a row of its own depth. */
  public parentOf(pathId: number): number {
    return this.parents[pathId]!;
  }

  /** The key `pathId` ends in; -1 for the empty path or an id never minted. */
  public keyIdOfPath(pathId: number): number {
    return this.keyOf[pathId] ?? -1;
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
