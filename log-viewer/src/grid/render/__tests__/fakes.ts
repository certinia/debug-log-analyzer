/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Boxes for a grid 10 rows high, as jsdom does no layout: the header to `row`, the totals
 * from 9 rows down, and row `index` one row below its place, except row `moved`, which
 * starts there and goes where `moveTo` puts it.
 */
export function fakeRowBoxes(row: number, moved: number): { moveTo(top: number): void } {
  let movedTop = moved * row;
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const at = (top: number, height = row): DOMRect =>
      ({ top, bottom: top + height, height, width: 500 }) as DOMRect;
    const index = Number(this.dataset.index ?? Number.NaN);
    return this.classList.contains('foot')
      ? at(9 * row)
      : this.classList.contains('scroller')
        ? at(0, 10 * row)
        : index === moved
          ? at(row + movedTop)
          : at(Number.isNaN(index) ? 0 : row + index * row);
  });
  return { moveTo: (top) => (movedTop = top) };
}

const globals = globalThis as { Highlight?: unknown; CSS?: unknown };

class FakeHighlight extends Set<Range> {
  priority = 0;
}

export interface FakeHighlights {
  registry: Map<string, FakeHighlight>;
  /** The text of each mark in highlight `name`, or in all of them. */
  marks(name?: string): string[];
  restore(): void;
}

/** Stands in for the CSS Highlight API, which jsdom lacks, until `restore`. */
export function fakeHighlights(): FakeHighlights {
  const real = { Highlight: globals.Highlight, CSS: globals.CSS };
  const registry = new Map<string, FakeHighlight>();
  globals.Highlight = FakeHighlight;
  globals.CSS = { highlights: registry };
  return {
    registry,
    marks: (name) =>
      [
        ...new Set(
          (name ? [registry.get(name) ?? []] : [...registry.values()]).flatMap((set) => [...set]),
        ),
      ].map(String),
    restore: () => Object.assign(globals, real),
  };
}
