/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';
import type { RowComponent } from 'tabulator-tables';

import type { SelectionView } from '../../../core/events/EventBus.js';
import { withCodeDrivenExpand } from '../../../tabulator/module/expandOrigin.js';
import { eventKeyChain, getEventKey } from '../../../core/log/eventKeys.js';

interface BucketRow {
  key?: string;
  _children?: unknown[];
}

const bucketOf = (row: RowComponent): BucketRow => row.getData() as BucketRow;

/**
 * The row a frame belongs to in a view whose rows merge occurrences.
 *
 * A bottom-up view heads the frame with a top-level row, so its own key finds it.
 * A top-down view mirrors the call path, so the walk descends the frame's
 * ancestors, matching each level by bucket and expanding as it goes. It falls
 * back to the deepest bucket it did resolve, so a level hidden by a filter lands
 * on the nearest visible ancestor rather than nothing.
 *
 * @param rows - the view's top-level rows
 * @param waitForRender - resolves once an expanded row's children exist
 */
export function findRootBucket(rows: RowComponent[], event: LogEvent): RowComponent | null {
  const key = getEventKey(event);
  return rows.find((row) => bucketOf(row).key === key) ?? null;
}

export async function findBucketRow(
  rows: RowComponent[],
  event: LogEvent,
  direction: SelectionView,
  waitForRender: () => Promise<void>,
): Promise<RowComponent | null> {
  if (direction === 'callers') {
    return findRootBucket(rows, event);
  }

  const path = eventKeyChain(event).reverse();

  let currentRows = rows;
  let matched: RowComponent | null = null;
  for (let depth = 0; depth < path.length; depth++) {
    const key = path[depth]!;
    const next = currentRows.find((row) => bucketOf(row).key === key);
    if (!next) {
      break;
    }
    matched = next;
    if (depth === path.length - 1) {
      break;
    }
    let children = next.getTreeChildren() ?? [];
    if (!children.length && bucketOf(next)._children?.length) {
      if (!next.isTreeExpanded()) {
        withCodeDrivenExpand(() => next.treeExpand());
      }
      // An open row can still be waiting on the renderer, and reading through
      // without waiting landed the descent on this row rather than the target.
      await waitForRender();
      children = next.getTreeChildren() ?? [];
    }
    currentRows = children;
  }
  return matched;
}
