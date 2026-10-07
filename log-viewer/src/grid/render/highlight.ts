/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Cells find searched carry this attribute, so marks land where the count came from. */
export const FIND_ATTR = 'data-grid-find';

const MATCH = 'find-match';
const CURRENT = 'current-find-match';

/** The CSS Highlight API: Chromium 105, Safari 17.2, Firefox 140. Without it, no marks. */
const supported = (): boolean => typeof CSS !== 'undefined' && 'highlights' in CSS;

// One pair for the document: CSS.highlights is global, and every grid adds to it.
let shared: { match: Highlight; current: Highlight } | null = null;

interface TextNodeAt {
  node: Text;
  start: number;
}

/** Every text node under `root`, shadow roots included, with its offset in the joined text. */
function textNodes(root: Node, out: TextNodeAt[], offset = { n: 0 }): TextNodeAt[] {
  const children = root.childNodes.length
    ? root.childNodes
    : ((root as Element).shadowRoot?.childNodes ?? root.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push({ node: child as Text, start: offset.n });
      offset.n += child.textContent?.length ?? 0;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      textNodes(child, out, offset);
    }
  }
  return out;
}

/** A range over [from, to) of the joined text, which may cross text nodes. */
function rangeOver(nodes: readonly TextNodeAt[], from: number, to: number): Range | null {
  const range = new Range();
  let started = false;
  for (const { node, start } of nodes) {
    const end = start + (node.textContent?.length ?? 0);
    if (!started && from < end) {
      range.setStart(node, from - start);
      started = true;
    }
    if (started && to <= end) {
      range.setEnd(node, to - start);
      return range;
    }
  }
  return null;
}

/**
 * Marks find matches in painted rows. A row's matches are numbered from its first match
 * on, cell by cell in DOM order, as core counted them; the one numbered `current` gets
 * the current-match highlight.
 */
export class FindHighlighter {
  private readonly ranges = new Map<HTMLElement, Range[]>();

  /** Marks `row`, whose first match is `first`; clears it first. -1 or no pattern: clear only. */
  mark(row: HTMLElement, first: number, pattern: RegExp | null, current: number): void {
    if (!supported()) {
      return;
    }
    this.unmark(row);
    if (!pattern || first < 0) {
      return;
    }
    shared ??= { match: new Highlight(), current: new Highlight() };
    const marked: Range[] = [];
    let n = first;
    for (const cell of row.querySelectorAll<HTMLElement>(`[${FIND_ATTR}]`)) {
      const nodes = textNodes(cell, []);
      const text = nodes.map((t) => t.node.textContent ?? '').join('');
      pattern.lastIndex = 0;
      for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
        const range = rangeOver(nodes, m.index, m.index + m[0].length);
        if (range) {
          (n === current ? shared.current : shared.match).add(range);
          marked.push(range);
        }
        n++;
      }
    }
    if (marked.length) {
      this.ranges.set(row, marked);
    }
    CSS.highlights.set(MATCH, shared.match);
    CSS.highlights.set(CURRENT, shared.current);
  }

  unmark(row: HTMLElement): void {
    const ranges = this.ranges.get(row);
    if (!ranges || !shared) {
      return;
    }
    for (const range of ranges) {
      shared.match.delete(range);
      shared.current.delete(range);
    }
    this.ranges.delete(row);
  }

  clear(): void {
    for (const row of [...this.ranges.keys()]) {
      this.unmark(row);
    }
  }
}
