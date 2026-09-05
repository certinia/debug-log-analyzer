/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Whether the code or the user opened a row.
 *
 * Tabulator's `dataTreeRowExpanded` event carries no origin, and `expandRow`'s
 * `silent` flag is ignored, so a twisty click and a `treeExpand()` call are
 * otherwise indistinguishable. The code that opens rows declares itself here.
 */

let depth = 0;

export function isCodeDrivenExpand(): boolean {
  return depth > 0;
}

/** Marks any row `body` opens as the code's own, not the user's. */
export function withCodeDrivenExpand<T>(body: () => T): T {
  depth += 1;
  try {
    return body();
  } finally {
    depth -= 1;
  }
}
