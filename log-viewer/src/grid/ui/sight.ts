/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The shown rows the reader can see, by index; or where the grid sits when none is:
 * `folded` when its rows are hidden but the box that holds them is in sight.
 */
export type Sight = { first: number; last: number } | 'above' | 'below' | 'folded';

/**
 * The painted rows the reader can see: inside the scroller, below its header, above its
 * totals, and inside every box that clips it and the window. A grid that fits its rows
 * scrolls with the page, so its own scroller alone cannot tell.
 */
export function sightOf(scroller: HTMLElement, rows: Iterable<HTMLElement>): Sight {
  const anchor = laidOut(scroller);
  const frame = anchor.getBoundingClientRect();
  const outer = clipOf(anchor);
  if (frame.bottom <= outer.top) {
    return 'above';
  }
  if (frame.top >= outer.bottom) {
    return 'below';
  }
  if (anchor !== scroller) {
    return 'folded';
  }
  const top = Math.max(
    outer.top,
    scroller.querySelector(':scope > .head')?.getBoundingClientRect().bottom ?? frame.top,
  );
  const bottom = Math.min(
    outer.bottom,
    scroller.querySelector(':scope > .foot')?.getBoundingClientRect().top ?? frame.bottom,
  );
  let first = -1;
  let last = -1;
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    if (box.bottom > top && box.top < bottom) {
      const index = Number(row.dataset.index);
      first = first < 0 ? index : Math.min(first, index);
      last = Math.max(last, index);
    }
  }
  // In sight with no row in sight: only the header shows, with the rows below it.
  return first < 0 ? 'below' : { first, last };
}

const CLIPS = /auto|scroll|hidden|clip/;

/** The window, cut down by each scrolling box around `el`. */
function clipOf(el: Element): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let up = parentOf(el); up; up = parentOf(up)) {
    if (CLIPS.test(getComputedStyle(up).overflowY)) {
      const box = up.getBoundingClientRect();
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
  }
  return { top, bottom };
}

/** `el`, or the nearest laid-out box around it, as for a folded section. */
function laidOut(el: Element): Element {
  for (let at: Element | null = el; at; at = parentOf(at)) {
    if (at.getBoundingClientRect().height > 0) {
      return at;
    }
  }
  return el;
}

function parentOf(el: Element): Element | null {
  return el.parentElement ?? ((el.getRootNode() as ShadowRoot).host || null);
}
