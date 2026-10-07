/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogCategory } from '@apexdevtools/apex-log-parser';

import { CHECK_EVERY, frameBudget } from '../utility/FrameBudget.js';
import { type SignatureLookup, signatureSlot } from './eventKeys.js';
import type { Derivation } from './LogStore.js';

/** One signature (`getEventKey`: type, namespace and text) and what its calls cost. */
export interface Signature {
  text: string;
  /** The worst call's category. */
  category: LogCategory;
  /** The call with the most self time. */
  eventIndex: number;
  /** Calls, timed or not. */
  count: number;
  /** Calls with self time above zero. */
  timedCount: number;
  /** Self time above zero, summed. */
  selfTime: number;
  /** The worst call's self time. */
  maxSelf: number;
  /** Total time over the outermost calls, so recursion counts its wall time once. */
  outerTotal: number;
}

/** The log's self time by signature. */
export interface SignatureTimes {
  /** Self time above zero over the whole log. */
  readonly totalSelf: number;
  /** Every signature with self time, the most first. A tie goes to the one timed first. */
  readonly ranked: readonly Signature[];
  /** The self times above zero of each signature's calls, ascending. */
  valuesOf(signatures: readonly Signature[]): number[][];
}

class Table implements SignatureTimes {
  readonly totalSelf: number;
  readonly ranked: readonly Signature[];
  private readonly self: Float64Array;
  // Each row's signature id.
  private readonly ids: Uint32Array;
  private readonly idCount: number;
  private readonly idOf: ReadonlyMap<Signature, number>;

  // `idOf` comes in order of first timed call, so the stable sort gives a tie to the first timed.
  constructor(self: Float64Array, ids: Uint32Array, idCount: number, idOf: Map<Signature, number>) {
    this.self = self;
    this.ids = ids;
    this.idCount = idCount;
    this.idOf = idOf;
    this.ranked = [...idOf.keys()].sort((a, b) => b.selfTime - a.selfTime);
    this.totalSelf = this.ranked.reduce((sum, signature) => sum + signature.selfTime, 0);
  }

  valuesOf(signatures: readonly Signature[]): number[][] {
    const values = signatures.map((): number[] => []);
    const slots = new Int32Array(this.idCount).fill(-1);
    signatures.forEach((signature, slot) => {
      const id = this.idOf.get(signature);
      if (id !== undefined) {
        slots[id] = slot;
      }
    });
    const { self, ids } = this;
    // In range: every row is below ids.length, every id below idCount, every slot
    // below signatures.length.
    for (let row = 0; row < ids.length; row++) {
      const value = self[row]!;
      if (!(value > 0)) {
        continue;
      }
      const slot = slots[ids[row]!]!;
      if (slot >= 0) {
        values[slot]!.push(value);
      }
    }
    for (const list of values) {
      list.sort((a, b) => a - b);
    }
    return values;
  }
}

// Per signature, while the pass runs.
interface Tally {
  count: number;
  timedCount: number;
  selfTime: number;
  maxRow: number;
  outerTotal: number;
  // The row after the last counted outermost call's subtree.
  countedUntil: number;
}

/**
 * {@link SignatureTimes} for the log, from one pass over its index. Built in slices:
 * the signature lives on the event objects, so this touches each one.
 */
export const signatureTimes: Derivation<SignatureTimes> = async (index) => {
  const tick = frameBudget({});
  const { rowCount, self, total, subtreeEnd } = index;
  const ids = new Uint32Array(rowCount);
  const lookup: SignatureLookup<number> = new Map();
  const tallies: Tally[] = [];
  // Ids in order of first timed call.
  const timed: number[] = [];
  for (let row = 0; row < rowCount; row++) {
    if (row % CHECK_EVERY === 0) {
      await tick();
    }
    const event = index.event(row);
    const byText = signatureSlot(lookup, event);
    let id = byText.get(event.text);
    if (id === undefined) {
      id = tallies.length;
      byText.set(event.text, id);
      tallies.push({
        count: 0,
        timedCount: 0,
        selfTime: 0,
        maxRow: row,
        outerTotal: 0,
        countedUntil: 0,
      });
    }
    ids[row] = id;
    // In range by construction: every row is below rowCount, every id below tallies.length.
    const tally = tallies[id]!;
    tally.count++;
    const rowSelf = self[row]!;
    if (rowSelf > 0) {
      if (++tally.timedCount === 1) {
        timed.push(id);
      }
      tally.selfTime += rowSelf;
    }
    if (rowSelf > self[tally.maxRow]!) {
      tally.maxRow = row;
    }
    if (row >= tally.countedUntil) {
      tally.outerTotal += Math.max(total[row]!, 0);
      tally.countedUntil = subtreeEnd[row]!;
    }
  }
  // In range: every id in `timed` is below tallies.length, and maxRow is a row.
  const idOf = new Map(
    timed.map((id) => {
      const { count, timedCount, selfTime, maxRow, outerTotal } = tallies[id]!;
      const worst = index.event(maxRow);
      const signature: Signature = {
        text: worst.text,
        category: worst.category,
        eventIndex: index.eventIndex[maxRow]!,
        count,
        timedCount,
        selfTime,
        maxSelf: self[maxRow]!,
        outerTotal,
      };
      return [signature, id];
    }),
  );
  return new Table(self, ids, tallies.length, idOf);
};
