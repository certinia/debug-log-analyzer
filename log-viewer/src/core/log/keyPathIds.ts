/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** The path every chain starts from, which no row stands for. */
export const ROOT_PATH_ID = 0;

/**
 * The bucket paths of one log, each interned to an integer.
 *
 * A row in a view whose rows merge occurrences is named by the bucket keys that
 * reach it, since one method holds a row under every caller it has. Joining
 * those keys into a string is what named it before, and the join was the whole
 * cost of a mark. An id per distinct path bounds the table by the tree rather
 * than by the calls, and makes matching an integer test.
 *
 * Every caller depends on one invariant: a row's id is the interned chain of the
 * frames the row holds. Compose ids through {@link pathOf} or
 * {@link prefixesOf} rather than folding {@link pathId} by hand, since the two
 * directions are separate spaces and an id from one means nothing in the other.
 *
 * One table per log, held by `LogStore`: an id means nothing to another log.
 */
export class KeyPathIds {
  private keyIds = new Map<string, number>();
  private keys: string[] = [];
  // Indexed by path id: the paths reachable from it, its own parent, and the key
  // it was minted with. Index 0 is the empty path.
  private children: Array<Map<number, number> | undefined> = [new Map()];
  private parents: number[] = [ROOT_PATH_ID];
  private keyOf: number[] = [-1];

  /**
   * The id for the path that reaches `key` through `parentPathId`, minted on
   * first use.
   *
   * @param parentPathId - {@link ROOT_PATH_ID} for the outermost key of a chain
   */
  public pathId(parentPathId: number, key: string): number {
    return this.step(parentPathId, this.keyId(key));
  }

  /**
   * The id of one bucket key, interned. A walk that steps the same key many times
   * interns it once and calls {@link step}, since hashing the key is what a path
   * id exists to avoid.
   */
  public keyId(key: string): number {
    let id = this.keyIds.get(key);
    if (id === undefined) {
      id = this.keys.length;
      this.keyIds.set(key, id);
      this.keys.push(key);
    }
    return id;
  }

  /** {@link pathId} for a key already interned by {@link keyId}. */
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

  /**
   * The id for a whole chain, outermost key first: what names a top-down row.
   *
   * @param keys - the chain innermost first, as `eventKeyChain` gives it
   */
  public pathOf(keys: readonly string[]): number {
    let id = ROOT_PATH_ID;
    for (let depth = keys.length - 1; depth >= 0; depth--) {
      id = this.pathId(id, keys[depth]!);
    }
    return id;
  }

  /**
   * An id per step out along a chain: the bottom-up rows a frame heads, which are
   * the frame alone, then the frame under one caller, and so on.
   *
   * @param keys - the chain innermost first
   */
  public prefixesOf(keys: readonly string[]): number[] {
    const prefixes: number[] = [];
    let id = ROOT_PATH_ID;
    for (const key of keys) {
      id = this.pathId(id, key);
      prefixes.push(id);
    }
    return prefixes;
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
