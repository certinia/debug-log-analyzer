/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
