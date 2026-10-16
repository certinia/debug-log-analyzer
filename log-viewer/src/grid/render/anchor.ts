/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parentIndex, sameTarget, type RowTarget, type RowView } from '../core/index.js';

export interface ShownRow {
  index: number;
  top: number;
  height: number;
}

export interface Viewport {
  scrollTop: number;
  maxScrollTop: number;
  height: number;
}

export interface Capture<R> {
  edge: 'top' | 'bottom' | null;
  /** The row across the middle of the viewport, then its ancestors, nearest first. */
  middle: readonly RowTarget<R>[];
  middleTop: number;
  tops: ReadonlyMap<RowTarget<R>, number>;
}

/** Where to put the viewport after the change. Null: leave the scroll position as it is. */
export type Restore = { edge: 'top' | 'bottom' } | { index: number; top: number } | null;

const EDGE_PX = 10;

export function capture<R>(
  viewport: Viewport,
  shown: readonly ShownRow[],
  rows: RowView<R>,
): Capture<R> {
  const { scrollTop, maxScrollTop } = viewport;
  const nearTop = scrollTop <= EDGE_PX;
  const nearBottom = maxScrollTop - scrollTop <= EDGE_PX;
  // A grid that overflows by less than two thresholds is near both: the closer one wins.
  const atTop = nearTop && (!nearBottom || scrollTop <= maxScrollTop - scrollTop);
  const edge = atTop ? 'top' : nearBottom ? 'bottom' : null;

  const tops = new Map<RowTarget<R>, number>();
  for (const row of shown) {
    tops.set(rows.targetAt(row.index), row.top);
  }

  const mid = viewport.height / 2;
  const middle = shown.find((row) => row.top <= mid && row.top + row.height > mid) ?? shown[0];
  const chain: RowTarget<R>[] = [];
  for (let i = middle ? middle.index : -1; i !== -1; i = parentIndex(rows, i)) {
    chain.push(rows.targetAt(i));
  }
  return { edge, middle: chain, middleTop: middle?.top ?? 0, tops };
}

/**
 * Where the rows go after a change. An edge the user was at wins. Then a toggled row
 * that was on screen goes back where it was. Else the middle row does, or the nearest
 * of its ancestors still shown, at the middle row's place.
 */
export function restore<R>(cap: Capture<R>, rows: RowView<R>, toggled?: RowTarget<R>): Restore {
  if (cap.edge) {
    return { edge: cap.edge };
  }
  if (toggled !== undefined) {
    for (const [target, top] of cap.tops) {
      if (sameTarget(target, toggled)) {
        const index = rows.indexOf(toggled);
        if (index !== -1) {
          return { index, top };
        }
      }
    }
  }
  for (const target of cap.middle) {
    const index = rows.indexOf(target);
    if (index !== -1) {
      return { index, top: cap.middleTop };
    }
  }
  return null;
}
