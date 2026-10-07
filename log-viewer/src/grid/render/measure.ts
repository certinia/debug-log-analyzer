/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

let context: CanvasRenderingContext2D | null = null;

/**
 * The widest of `texts` in `font`, in CSS pixels: what a column sized to its content
 * needs, before padding. Canvas measures without layout, so it costs no reflow.
 */
export function textWidth(texts: Iterable<string>, font: string): number {
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) {
    return 0;
  }
  context.font = font;
  let widest = 0;
  for (const text of texts) {
    widest = Math.max(widest, context.measureText(text).width);
  }
  return Math.ceil(widest);
}

/** The font a cell draws its text in, to measure with. */
export const fontOf = (cell: Element): string => getComputedStyle(cell).font;
