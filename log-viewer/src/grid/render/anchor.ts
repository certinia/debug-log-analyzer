/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { Group, type RowKey, type RowView } from '../core/index.js';

/** A row as it can be found again after the rows change: a data row's key, or its group. */
type Target<R> = RowKey | Group<R>;

/** A row on screen at capture, with where its top sat in the viewport. */
export interface ShownRow {
  index: number;
  /** Its top, from the top of the viewport. */
  top: number;
  height: number;
}

export interface Viewport {
  scrollTop: number;
  maxScrollTop: number;
  height: number;
}

/** Where the user was before a sort, filter or toggle. */
export interface Capture<R> {
  edge: 'top' | 'bottom' | null;
  /** The row across the middle of the viewport, then its ancestors, nearest first. */
  middle: readonly Target<R>[];
  middleTop: number;
  /** The viewport top of each data row and group on screen. */
  tops: ReadonlyMap<Target<R>, number>;
}

/** Where to put the viewport after the change. Null: leave the scroll position as it is. */
export type Restore = { edge: 'top' | 'bottom' } | { index: number; top: number } | null;

/** Within this many pixels of an edge, the user is at that edge. */
const EDGE_PX = 10;

const targetAt = <R>(rows: RowView<R>, index: number): Target<R> => {
  const entry = rows.rowAt(index);
  return entry instanceof Group ? entry : rows.keyAt(index);
};

/** Groups are made again by each build, so a group is found by its key. */
const sameTarget = <R>(a: Target<R>, b: Target<R>): boolean =>
  a instanceof Group ? b instanceof Group && a.key === b.key : a === b;

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

  const tops = new Map<Target<R>, number>();
  for (const row of shown) {
    tops.set(targetAt(rows, row.index), row.top);
  }

  const mid = viewport.height / 2;
  const middle = shown.find((row) => row.top <= mid && row.top + row.height > mid) ?? shown[0];
  const chain: Target<R>[] = [];
  if (middle) {
    chain.push(targetAt(rows, middle.index));
    let depth = rows.depthAt(middle.index);
    for (let i = middle.index - 1; i >= 0 && depth > 0; i--) {
      if (rows.depthAt(i) < depth) {
        chain.push(targetAt(rows, i));
        depth = rows.depthAt(i);
      }
    }
  }
  return { edge, middle: chain, middleTop: middle?.top ?? 0, tops };
}

/**
 * Where the rows go after a change. An edge the user was at wins. Then a toggled row
 * that was on screen goes back where it was. Else the middle row does, or the nearest
 * of its ancestors still shown, at the middle row's place.
 */
export function restore<R>(cap: Capture<R>, rows: RowView<R>, toggled?: Target<R>): Restore {
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
