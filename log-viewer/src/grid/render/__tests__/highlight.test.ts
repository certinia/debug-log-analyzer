/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { FIND_ATTR, FindHighlighter } from '../highlight.js';

/** jsdom has no CSS Highlight API. */
class FakeHighlight extends Set<Range> {
  priority = 0;
}
const registry = new Map<string, FakeHighlight>();

beforeAll(() => {
  (globalThis as { Highlight?: unknown }).Highlight = FakeHighlight;
  (globalThis as { CSS?: unknown }).CSS = { highlights: registry };
});

function row(...cells: string[]): HTMLElement {
  const el = document.createElement('div');
  for (const text of cells) {
    const cell = document.createElement('div');
    cell.setAttribute(FIND_ATTR, '');
    cell.textContent = text;
    el.append(cell);
  }
  return el;
}

const texts = (name: string): string[] => [...(registry.get(name) ?? [])].map(String);

describe('FindHighlighter', () => {
  it('lays the current match over a layer of its own, as the editor lays it over the selection', () => {
    const highlighter = new FindHighlighter();
    const el = row('Decimal.compareTo(Decimal)');
    highlighter.mark(el, 0, /Decimal/g, 1);

    expect(texts('lv-grid-find-match')).toEqual(['Decimal']);
    expect(texts('lv-grid-current-find-match')).toEqual(['Decimal']);
    const [current] = registry.get('lv-grid-current-find-match') ?? [];
    expect(registry.get('lv-grid-current-find-match-under')?.has(current as Range)).toBe(true);

    const priority = (name: string): number => registry.get(name)?.priority ?? Number.NaN;
    expect(priority('lv-grid-find-match')).toBeLessThan(
      priority('lv-grid-current-find-match-under'),
    );
    expect(priority('lv-grid-current-find-match-under')).toBeLessThan(
      priority('lv-grid-current-find-match'),
    );

    highlighter.unmark(el);
    expect(registry.get('lv-grid-current-find-match-under')?.size).toBe(0);
    expect(registry.get('lv-grid-current-find-match')?.size).toBe(0);
  });
});
