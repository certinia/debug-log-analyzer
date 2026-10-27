/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { CountColumn, HeapColumn } from '@apexdevtools/apex-log-parser';

import type { LogIndex } from './LogIndex.js';

/** One metric's own part and its part with every descendant, by index row. */
export interface SelfTotalColumns<T extends Int32Array | Float64Array> {
  readonly self: T;
  readonly total: T;
}

/**
 * Every metric a call tree row reports, by index row, so a pass over the rows
 * reads typed arrays rather than event objects. A metric the log's debug levels
 * do not record reads as 0.
 *
 * A self part takes the self part of each event the levels hide under the row;
 * a total is the event's own.
 */
export interface RowMetrics {
  /** Nanoseconds. */
  readonly duration: SelfTotalColumns<Float64Array>;
  readonly dmlCount: SelfTotalColumns<Int32Array>;
  readonly soqlCount: SelfTotalColumns<Int32Array>;
  readonly soslCount: SelfTotalColumns<Int32Array>;
  readonly dmlRowCount: SelfTotalColumns<Int32Array>;
  readonly soqlRowCount: SelfTotalColumns<Int32Array>;
  readonly soslRowCount: SelfTotalColumns<Int32Array>;
  readonly thrownCount: SelfTotalColumns<Int32Array>;
  /** Bytes, signed: net of frees. */
  readonly heapAllocated: SelfTotalColumns<Float64Array>;
  /** Bytes allocated, frees ignored. */
  readonly heapGross: SelfTotalColumns<Float64Array>;
  /** Bytes: the highest live heap inside the row. */
  readonly heapPeak: Float64Array;
}

const held = new WeakMap<LogIndex, RowMetrics>();

/** The metrics of `index`'s rows, made once per index. */
export function rowMetrics(index: LogIndex): RowMetrics {
  let metrics = held.get(index);
  if (!metrics) {
    metrics = build(index);
    held.set(index, metrics);
  }
  return metrics;
}

function build(index: LogIndex): RowMetrics {
  const columns = index.log.columns;
  // One zero column per kind for every metric the log does not record.
  let noCounts: Int32Array | undefined;
  let noBytes: Float64Array | undefined;
  const count = (column: CountColumn | null): SelfTotalColumns<Int32Array> => {
    if (!column) {
      noCounts ??= new Int32Array(index.rowCount);
      return { self: noCounts, total: noCounts };
    }
    return { self: index.selfColumn(column.self), total: index.column(column.total) };
  };
  const heap = (column: HeapColumn | null): SelfTotalColumns<Float64Array> => {
    if (!column) {
      noBytes ??= new Float64Array(index.rowCount);
      return { self: noBytes, total: noBytes };
    }
    return { self: index.selfColumn(column.self), total: index.column(column.total) };
  };
  return {
    duration: { self: index.self, total: index.total },
    dmlCount: count(columns.dmlCount),
    soqlCount: count(columns.soqlCount),
    soslCount: count(columns.soslCount),
    dmlRowCount: count(columns.dmlRowCount),
    soqlRowCount: count(columns.soqlRowCount),
    soslRowCount: count(columns.soslRowCount),
    thrownCount: count(columns.thrownCount),
    heapAllocated: heap(columns.heapAllocated),
    heapGross: heap(columns.heapGross),
    heapPeak: columns.heapPeak
      ? index.column(columns.heapPeak)
      : (noBytes ??= new Float64Array(index.rowCount)),
  };
}
