/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** One total, for the footer and for each group. */
export interface Calc<R> {
  /**
   * Which rows `of` gets. `top` (the default): the top-level rows that pass the filters.
   * `all`: every row that passes the filters, at any depth, expanded or not.
   */
  scope?: 'top' | 'all';
  /**
   * The total, or a generator that yields between small pieces of work and returns it, so
   * a long total runs in slices. Must not depend on row order: totals are kept across a sort.
   */
  of(rows: readonly R[]): number | Generator<void, number, void>;
}

/** Totals by name, one per column that has a calc. */
export type Calcs<R> = Readonly<Record<string, Calc<R>>>;
export type Totals = Readonly<Record<string, number>>;

/**
 * Rows a plain total reads between yields. A yield per row costs more than the sum, and an
 * `all` scope can be every row of a large tree.
 */
const ROWS_PER_YIELD = 1024;

/** Sums `value` over the rows, in slices. */
export function sum<R>(value: (row: R) => number, scope?: Calc<R>['scope']): Calc<R> {
  return {
    scope,
    *of(rows) {
      let total = 0;
      for (let i = 0; i < rows.length; i++) {
        total += value(rows[i] as R);
        if (i % ROWS_PER_YIELD === ROWS_PER_YIELD - 1) {
          yield;
        }
      }
      return total;
    },
  };
}

/** The highest `value` over the rows, or 0 for none, in slices. */
export function max<R>(value: (row: R) => number, scope?: Calc<R>['scope']): Calc<R> {
  return {
    scope,
    *of(rows) {
      let most = rows.length ? -Infinity : 0;
      for (let i = 0; i < rows.length; i++) {
        most = Math.max(most, value(rows[i] as R));
        if (i % ROWS_PER_YIELD === ROWS_PER_YIELD - 1) {
          yield;
        }
      }
      return most;
    },
  };
}

export const needsAll = <R>(calcs: Calcs<R>): boolean =>
  Object.values(calcs).some((calc) => calc.scope === 'all');

/**
 * Runs each calc on the rows its scope asks for, yielding wherever a calc does.
 * `all` may be empty when no calc needs it.
 */
export function* totalsOf<R>(
  calcs: Calcs<R>,
  top: readonly R[],
  all: readonly R[],
): Generator<void, Totals, void> {
  const out: Record<string, number> = {};
  for (const [name, calc] of Object.entries(calcs)) {
    const total = calc.of(calc.scope === 'all' ? all : top);
    out[name] = typeof total === 'number' ? total : yield* total;
  }
  return out;
}
