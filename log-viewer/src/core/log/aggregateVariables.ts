/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { frameBudget, type FrameBudgetOptions } from '../utility/FrameBudget.js';
import { frameVariablesFor, type VariableIndex, type VariableRow } from './frameVariables.js';
import type { LogStore } from './LogStore.js';

/**
 * What a merged row's calls held, compared across them.
 *
 * A merged row has no single frame, so it is answered by the spread rather than
 * by one reading: 340 calls with 340 different `accountId` values and one
 * `batchSize` of 200 says which input varied, which is the verdict the grids
 * beside it do not carry.
 *
 * Statics are left out. A static lives for the whole transaction, so it moves
 * for reasons the row does not own, and comparing it would report the log's
 * history as this row's spread.
 */

/** Distinct values held per name before the rest go uncounted.
 *
 *  Past it the screen reads "over 100 values", never a distinct count the walk
 *  did not finish. A hundred is already more than a reader can take in, and it
 *  bounds what a 500k-line log can hold here. */
export const MAX_VALUES_PER_NAME = 100;

/** One value a name held, and where to find a call that held it. */
export interface SpreadValue {
  /** The log's own text, as it wrote it. */
  text: string;
  address: string | null;
  /** How many of the read calls held it. */
  calls: number;
  /** One call that held it, so the reader can go there. */
  at: number;
}

/** One name, across the calls the row counts. */
export interface VariableSpread {
  name: string;
  declaredType: string | null;
  /** Distinct values, most calls first. */
  values: SpreadValue[];
  /** Calls that had the name in scope. */
  calls: number;
  /** Calls that declared it and never wrote it. */
  unassigned: number;
  /** More distinct values than the cap holds, so `values` is not all of them. */
  capped: boolean;
}

export interface AggregateVariables {
  /** Frames read. */
  frames: number;
  locals: VariableSpread[];
  /** The class owning the fields, where every call agreed on one. */
  thisType: string | null;
  /** Distinct objects the calls ran on. */
  objects: number;
  fields: VariableSpread[];
  /** A frame read ran past the end of a truncated log, so a missing write may be
   *  unrecorded rather than absent. */
  truncated: boolean;
}

/** A spread while it is still being gathered, values keyed by their identity. */
interface Gathering {
  name: string;
  declaredType: string | null;
  byValue: Map<string, SpreadValue>;
  calls: number;
  unassigned: number;
  capped: boolean;
}

/**
 * What the calls `frames` names held, compared across them.
 *
 * Returns null when the walk is abandoned (see {@link FrameBudgetOptions}).
 */
async function compareFrames(
  store: LogStore,
  frames: readonly number[],
  index: VariableIndex | null,
  options: FrameBudgetOptions,
): Promise<AggregateVariables | null> {
  const tick = frameBudget(options);
  const locals = new Map<string, Gathering>();
  const fields = new Map<string, Gathering>();
  const objects = new Set<string>();
  const classes = new Set<string>();
  let read = 0;
  let truncated = false;

  // Every frame, with no `outermostEvents` dedupe — deliberately, and unlike
  // every other multi-frame read here. A recursive frame's nested call is its
  // own call with its own values, so dropping it would undercount the spread.
  for (const eventIndex of frames) {
    // Per frame rather than every CHECK_EVERY: one read scans a whole frame's
    // lines, so 256 of them would overrun the slice many times over, and asking
    // the clock once per read costs nothing beside it.
    if (!(await tick())) {
      return null;
    }
    const frame = frameVariablesFor(store, eventIndex, index, { statics: false });
    if (!frame) {
      continue;
    }
    read++;
    truncated ||= frame.truncated;
    for (const row of frame.locals) {
      hold(locals, row, eventIndex);
    }
    for (const row of frame.fields) {
      hold(fields, row, eventIndex);
    }
    if (frame.thisType) {
      classes.add(frame.thisType);
    }
    if (frame.thisRow?.objectAddress) {
      objects.add(frame.thisRow.objectAddress);
    }
  }

  return {
    frames: read,
    locals: spreadsOf(locals),
    // Only where every call agreed: two classes under one row means the reading
    // is not one class's.
    thisType: classes.size === 1 ? [...classes][0]! : null,
    objects: objects.size,
    fields: spreadsOf(fields),
    truncated,
  };
}

/** Adds one call's reading of a name to what the walk holds for it. */
function hold(into: Map<string, Gathering>, row: VariableRow, at: number): void {
  let held = into.get(row.name);
  if (!held) {
    held = {
      name: row.name,
      declaredType: row.declaredType,
      byValue: new Map(),
      calls: 0,
      unassigned: 0,
      capped: false,
    };
    into.set(row.name, held);
  }
  held.calls++;
  held.declaredType ??= row.declaredType;
  if (!row.assigned) {
    // In scope at its default, with no value the log recorded.
    held.unassigned++;
    return;
  }
  // The log's own text is the identity: two calls that named the same address
  // held the same object, and two that wrote the same text held the same value.
  const identity = row.value || row.address || '';
  const seen = held.byValue.get(identity);
  if (seen) {
    seen.calls++;
  } else if (held.byValue.size < MAX_VALUES_PER_NAME) {
    held.byValue.set(identity, { text: row.value, address: row.address, calls: 1, at });
  } else {
    held.capped = true;
  }
}

/**
 * The gathered names as rows, in the order they read.
 *
 * The names that varied lead, most distinct values first, since they are what
 * explains the spread; then the constants, then the names every call declared
 * and never wrote.
 */
function spreadsOf(held: ReadonlyMap<string, Gathering>): VariableSpread[] {
  return [...held.values()]
    .map((entry) => ({
      name: entry.name,
      declaredType: entry.declaredType,
      values: [...entry.byValue.values()].sort((left, right) => right.calls - left.calls),
      calls: entry.calls,
      unassigned: entry.unassigned,
      capped: entry.capped,
    }))
    .sort(
      (left, right) =>
        right.values.length - left.values.length || left.name.localeCompare(right.name),
    );
}

/** Memo of the walk: the log never changes after parse, so each row's frames are
 *  compared once. Keyed by the frames array, which stays the same object while
 *  the selection does. */
const compared = new WeakMap<object, AggregateVariables>();

/** The memoised comparison for `frames`, or undefined if it has never been
 *  walked. Lets a caller render an already-walked selection without showing a
 *  placeholder first. */
export function cachedAggregateVariables(frames: object): AggregateVariables | undefined {
  return compared.get(frames);
}

/**
 * {@link compareFrames} memoised on the `frames` array's identity. An abandoned
 * walk is not memoised.
 */
export async function aggregateVariablesFor(
  store: LogStore,
  frames: readonly number[],
  index: VariableIndex | null,
  options: FrameBudgetOptions,
): Promise<AggregateVariables | null> {
  const held = compared.get(frames);
  if (held) {
    return held;
  }
  const spread = await compareFrames(store, frames, index, options);
  if (spread) {
    compared.set(frames, spread);
  }
  return spread;
}
