/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent, ApexLog, EventOf, FrameEvent } from '@apexdevtools/apex-log-parser';

import { CHECK_EVERY, frameBudget, type FrameBudgetOptions } from '../utility/FrameBudget.js';
import { KeyPathIds } from './keyPathIds.js';
import { type CapabilityId, findLevelGap, type LevelGap } from './levelCapabilities.js';
import { type DebugLevels, hiddenByLevels } from './levelFilter.js';
import { type LogIndex, LogIndexBuilder } from './LogIndex.js';
import { signaturesOf } from './signatures.js';

export type Stack = FrameEvent[];

/** What {@link LogStore.derive} runs once per log. */
export type Derivation<T> = (index: LogIndex, store: LogStore) => T | Promise<T>;

/**
 * A parsed log as shown, and the lookups every view takes from it.
 *
 * The log is shown as captured, or as if captured at levels the user chose, which
 * hides the events finer than them. `log` is always the parse as captured: what
 * the whole log states, as its limits and issues. What depends on the levels,
 * as which events show, comes from the store.
 *
 * One store per shown log, so a store is immutable and a new choice of levels is
 * a new value — which is what lets a context consumer see the change.
 */
export class LogStore {
  /** The parse, as captured. */
  readonly log: ApexLog;
  /** The levels the log is shown at. */
  readonly debugLevels: DebugLevels;
  /** The store of the log as captured: this store, unless levels hide some events. */
  readonly captured: LogStore;

  /** By event id, 1 for a hidden event; null when none is. */
  private readonly hidden: Uint8Array | null;
  private _keyPathIds: KeyPathIds | null = null;
  private _logIndex: Promise<LogIndex> | null = null;
  private _namespaces: readonly string[] | null = null;
  private readonly _derived = new WeakMap<Derivation<unknown>, Promise<unknown>>();

  constructor(
    log: ApexLog,
    shown?: { levels: DebugLevels; hidden: Uint8Array; captured: LogStore },
  ) {
    this.log = log;
    this.debugLevels = shown?.levels ?? log.debugLevels;
    this.hidden = shown?.hidden ?? null;
    this.captured = shown?.captured ?? this;
  }

  /** Whether the debug levels could keep `id`'s events off screen, and why. */
  levelGap(id: CapabilityId): LevelGap | null {
    return findLevelGap(id, this.log.debugLevels, this.debugLevels);
  }

  /** True when event `eventIndex` is in the log and shown. */
  isShown(eventIndex: number): boolean {
    return eventIndex >= 1 && eventIndex <= this.log.eventCount && !this.hidden?.[eventIndex];
  }

  /** The shown event with `eventIndex`, a new object each call; null if hidden or absent. */
  eventByIndex(eventIndex: number): ApexEvent | null {
    return this.isShown(eventIndex) ? this.log.event(eventIndex) : null;
  }

  /** The id of the nearest shown frame above `eventIndex`, or 0 at the top of the log. */
  parentOf(eventIndex: number): number {
    const { parent } = this.log.columns;
    let id = parent[eventIndex] ?? 0;
    while (id > 0 && this.hidden?.[id]) {
      id = parent[id]!;
    }
    return Math.max(id, 0);
  }

  /** Every shown event, in id order: a new object each, so read columns for a pass over all. */
  *events(): Generator<ApexEvent> {
    const last = this.log.eventCount;
    for (let id = 1; id <= last; id++) {
      if (!this.hidden?.[id]) {
        yield this.log.event(id)!; // in range
      }
    }
  }

  /** Every shown `EXCEPTION_THROWN` and `FATAL_ERROR`, in id order. */
  get exceptions(): readonly EventOf<'EXCEPTION_THROWN' | 'FATAL_ERROR'>[] {
    return this.shownOf(this.log.exceptions);
  }

  /** The shown code units where work starts. */
  get entryPoints(): readonly EventOf<'CODE_UNIT_STARTED'>[] {
    return this.shownOf(this.log.entryPoints);
  }

  /** The shown frames whose end is inferred. */
  get unclosedFrames(): readonly FrameEvent[] {
    return this.shownOf(this.log.unclosedFrames);
  }

  /** Every namespace a shown event states, in the order the log first states them. */
  get namespaces(): readonly string[] {
    if (!this.hidden) {
      return this.log.namespaces;
    }
    if (!this._namespaces) {
      const { ids, values } = this.log.columns.namespace;
      const stated = new Uint8Array(values.length);
      const last = this.log.eventCount;
      for (let id = 1; id <= last; id++) {
        const at = ids[id]!;
        if (at >= 0 && !this.hidden[id]) {
          stated[at] = 1;
        }
      }
      this._namespaces = this.log.namespaces.filter((_, at) => stated[at]);
    }
    return this._namespaces;
  }

  /**
   * The distinct frames `levels` parents above each of `eventIndexes`: what a
   * merged row standing for its callers is, since a row at path depth D sits
   * D - 1 hops above the calls it counts.
   *
   * How far the dedupe folds is the log's business. A call in a loop has one
   * caller; a call made once per record has one caller each, so the answer can
   * be as long as what was asked about.
   *
   * @param levels - hops to climb, at least one: the caller guards the rest so
   *   it can hand back the calls it already holds rather than a copy
   */
  framesAbove(eventIndexes: readonly number[], levels: number): number[] {
    const own = new Set<number>();
    for (const index of eventIndexes) {
      let id = this.isShown(index) ? index : 0;
      for (let up = levels; up > 0 && id > 0; up--) {
        id = this.parentOf(id);
      }
      if (id > 0) {
        own.add(id);
      }
    }
    return [...own];
  }

  /** The shown ids from the top of the log down to `eventIndex`; empty if it is hidden or absent. */
  pathTo(eventIndex: number): number[] {
    const path: number[] = [];
    for (let id = this.isShown(eventIndex) ? eventIndex : 0; id > 0; id = this.parentOf(id)) {
      path.push(id);
    }
    return path.reverse();
  }

  /**
   * The shown frames from the top of the log down to `eventIndex`, the event
   * itself last when it is a frame. Empty if the log shows no such event.
   */
  stackByEventIndex(eventIndex: number): Stack {
    // O(depth) up the parent column, rather than a scan of the whole tree.
    const stack: Stack = [];
    const { isFrame } = this.log.columns;
    for (let id = this.isShown(eventIndex) ? eventIndex : 0; id > 0; id = this.parentOf(id)) {
      if (isFrame[id]) {
        stack.push(this.log.event(id) as FrameEvent); // isFrame checked
      }
    }
    return stack.reverse();
  }

  /** The interned keys and bucket paths of this log, shared by every view that
   *  marks a row whose occurrences are merged. */
  keyPathIds(): KeyPathIds {
    return (this._keyPathIds ??= new KeyPathIds(signaturesOf(this.log), (id) => this.parentOf(id)));
  }

  /**
   * The shown log as flat columns, built once in slices that hand the thread
   * back between them.
   *
   * One build, shared by every caller, so it takes no signal: a caller that stops
   * waiting just stops awaiting it.
   */
  logIndex(options: Pick<FrameBudgetOptions, 'yieldSlice'> = {}): Promise<LogIndex> {
    return (this._logIndex ??= buildInSlices(this.log, this.hidden, options).catch(
      (error: unknown) => {
        this._logIndex = null;
        throw error;
      },
    ));
  }

  /**
   * `fn` run once over this log's index, its result shared by every caller.
   * The function is the cache key, so pass a module-level one: an inline arrow is
   * a new key on every call. `fn` gets this store too, to derive from another `fn`.
   */
  derive<T>(fn: Derivation<T>): Promise<T> {
    let derived = this._derived.get(fn) as Promise<T> | undefined;
    if (!derived) {
      derived = this.logIndex()
        .then((index) => fn(index, this))
        .catch((error: unknown) => {
          this._derived.delete(fn);
          throw error;
        });
      this._derived.set(fn, derived);
    }
    return derived;
  }

  private shownOf<E extends ApexEvent>(events: readonly E[]): readonly E[] {
    const hidden = this.hidden;
    return hidden ? events.filter((event) => !hidden[event.id]) : events;
  }
}

async function buildInSlices(
  log: ApexLog,
  hidden: Uint8Array | null,
  options: Pick<FrameBudgetOptions, 'yieldSlice'>,
): Promise<LogIndex> {
  const builder = new LogIndexBuilder(log, hidden);
  const tick = frameBudget(options);
  while (!builder.step(CHECK_EVERY)) {
    await tick();
  }
  return builder.finish();
}

/**
 * `store`'s log as if captured at `chosen` levels, built in slices. The captured
 * store when nothing is hidden. Null once `options.signal` aborts.
 */
export async function filterByLevels(
  store: LogStore,
  chosen: DebugLevels,
  options: FrameBudgetOptions = {},
): Promise<LogStore | null> {
  const captured = store.captured;
  const { log } = captured;
  const hidden = await hiddenByLevels(log, chosen, options);
  if (hidden === undefined) {
    return null;
  }
  if (!hidden) {
    return captured;
  }
  return new LogStore(log, { levels: { ...log.debugLevels, ...chosen }, hidden, captured });
}

const stores = new WeakMap<ApexLog, LogStore>();

/** The store for a parsed log as captured — the same store every time, so its
 *  index and derived values are shared however the log is reached. */
export function logStoreFor(log: ApexLog): LogStore {
  let store = stores.get(log);
  if (!store) {
    store = new LogStore(log);
    stores.set(log, store);
  }
  return store;
}

let current: LogStore | null = null;

/** Makes `store` the log on screen, and returns it to provide to the views. */
export function setCurrentLog(store: LogStore): LogStore {
  current = store;
  return current;
}

/**
 * The store for the log on screen, or null before the first parse.
 *
 * For code a component cannot hand a store to. A component takes its store from
 * the log context instead, so it re-renders when the log changes.
 */
export function currentLogStore(): LogStore | null {
  return current;
}
