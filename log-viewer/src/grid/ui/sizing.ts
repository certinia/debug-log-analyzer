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

/**
 * One track per shown column, so header, rows and footer line up. A width the user set
 * wins over the column's own. They go on the scroller: the host's inline style belongs to
 * whoever places it.
 */
export function columnTracks<R>(
  columns: readonly GridColumn<R>[],
  userWidths: ReadonlyMap<string, number>,
): Record<string, string> {
  const widths = columns.map((column) => {
    const width = userWidths.get(column.id) ?? column.width;
    return typeof width === 'number' ? Math.max(width, minWidthOf(column)) : null;
  });
  const tracks = columns.map((column, i) => {
    const width = widths[i];
    return width === null || width === undefined
      ? `minmax(${minWidthOf(column)}px, 1fr)`
      : `${width}px`;
  });
  const minWidth = columns.reduce((sum, column, i) => sum + (widths[i] ?? minWidthOf(column)), 0);
  return { '--grid-cols': tracks.join(' '), '--grid-min-width': `${minWidth}px` };
}
