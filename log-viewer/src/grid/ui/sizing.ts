/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GridColumn } from './column.js';

const MIN_WIDTH = 40;

let context: CanvasRenderingContext2D | null = null;

export const minWidthOf = <R>(column: GridColumn<R>): number => column.minWidth ?? MIN_WIDTH;

const px = (value: string): number => Number.parseFloat(value) || 0;

/** The width a cell needs to show its text on one line, with its padding and twisty. */
export function naturalWidth(cell: HTMLElement): number {
  const style = getComputedStyle(cell);
  context ??= document.createElement('canvas').getContext('2d');
  let text = 0;
  if (context) {
    // Canvas measures without layout, so it costs no reflow.
    context.font = style.font;
    text = Math.ceil(context.measureText(cell.textContent?.trim() ?? '').width);
  }
  const twisty = cell.querySelector<HTMLElement>('.twisty')?.offsetWidth ?? 0;
  const padded = text + twisty + px(style.paddingInlineStart) + px(style.paddingInlineEnd);
  // A template cell, such as a bar, may hold no text but still need room.
  return Math.ceil(Math.max(padded, cell.scrollWidth));
}

/** The narrowest width at which a header's title wraps to two lines at most, sort arrow included. */
export function headerWidth(head: HTMLElement): number {
  const title = head.querySelector<HTMLElement>('.title');
  context ??= document.createElement('canvas').getContext('2d');
  if (!title || !context) {
    return naturalWidth(head);
  }
  const style = getComputedStyle(head);
  context.font = getComputedStyle(title).font;
  const measure = (words: readonly string[]): number =>
    Math.ceil(context?.measureText(words.join(' ')).width ?? 0);
  const sorter = title.querySelector<HTMLElement>('.sorter');
  // It sits after the last word, so on the second line.
  const arrow = sorter
    ? sorter.getBoundingClientRect().width + px(getComputedStyle(sorter).marginInlineStart)
    : 0;
  const words = (title.textContent ?? '').trim().split(/\s+/);
  const lines = words.map((_, i) =>
    i === 0
      ? measure(words) + arrow
      : Math.max(measure(words.slice(0, i)), measure(words.slice(i)) + arrow),
  );
  const padding = px(style.paddingInlineStart) + px(style.paddingInlineEnd);
  return Math.ceil(Math.min(...lines) + padding);
}

/** A column's track before the filler rule: pixels, a share of the free room, or its content. */
type Size = number | 'flex' | 'fit';

/**
 * A column being measured fits its content. Else a width the user set wins over the
 * column's own, and a `content` column takes its measured width, or its minimum until then.
 */
function sizeOf<R>(
  column: GridColumn<R>,
  userWidths: ReadonlyMap<string, number>,
  measured: ReadonlyMap<string, number>,
  measuring: ReadonlySet<string>,
): Size {
  if (measuring.has(column.id)) {
    return 'fit';
  }
  const width = userWidths.get(column.id) ?? column.width;
  if (typeof width === 'number') {
    return Math.max(width, minWidthOf(column));
  }
  if (width === 'content') {
    return Math.max(measured.get(column.id) ?? 0, minWidthOf(column));
  }
  return 'flex';
}

/**
 * One track per shown column, so header, rows and footer line up. With no `flex` track
 * shown, the last column takes the free room, so the grid always fills its width. They go
 * on the scroller: the host's inline style belongs to whoever places it.
 */
export function columnTracks<R>(
  columns: readonly GridColumn<R>[],
  userWidths: ReadonlyMap<string, number>,
  measured: ReadonlyMap<string, number> = new Map(),
  measuring: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const sizes = columns.map((column) => sizeOf(column, userWidths, measured, measuring));
  const filler = sizes.includes('flex') ? -1 : sizes.length - 1;
  const tracks = columns.map((column, i) => {
    const size = sizes[i];
    if (size === 'flex') {
      return `minmax(${minWidthOf(column)}px, 1fr)`;
    }
    if (size === 'fit' || size === undefined) {
      return 'max-content';
    }
    return i === filler ? `minmax(${size}px, 1fr)` : `${size}px`;
  });
  const minWidth = columns.reduce((sum, column, i) => {
    const size = sizes[i];
    return sum + (typeof size === 'number' ? size : minWidthOf(column));
  }, 0);
  return { '--grid-cols': tracks.join(' '), '--grid-min-width': `${minWidth}px` };
}
