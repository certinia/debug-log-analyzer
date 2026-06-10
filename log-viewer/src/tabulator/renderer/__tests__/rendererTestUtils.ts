/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Structural slice of VirtualVerticalRenderer's height-index internals. */
export interface HeightIndexInternals {
  measuredHeight: Float64Array;
  isMeasured: Uint8Array;
  fenwickMeasured: { resize: (n: number) => void };
  fenwickUnmeasuredCount: { resize: (n: number) => void; bulkInitConstant: (v: number) => void };
  measuredSum: number;
  measuredCount: number;
  rowsCountCached: number;
}

/**
 * Seed a freshly-constructed renderer's height index for `rowsCount` rows
 * (all unmeasured), bypassing the RowManager-driven init path that unit
 * tests don't exercise.
 */
export function seedHeightIndex(r: HeightIndexInternals, rowsCount: number): void {
  r.measuredHeight = new Float64Array(rowsCount);
  r.isMeasured = new Uint8Array(rowsCount);
  r.fenwickMeasured.resize(rowsCount);
  r.fenwickUnmeasuredCount.resize(rowsCount);
  r.fenwickUnmeasuredCount.bulkInitConstant(1);
  r.measuredSum = 0;
  r.measuredCount = 0;
  r.rowsCountCached = rowsCount;
}
