/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';
import type { RowComponent } from 'tabulator-tables';

import type { SelectionView } from '../../../core/events/EventBus.js';
import { getEventKey } from './Aggregation.js';

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
export async function findBucketRow(
  rows: RowComponent[],
  event: LogEvent,
  direction: SelectionView,
  waitForRender: () => Promise<void>,
): Promise<RowComponent | null> {
  if (direction === 'callers') {
    const key = getEventKey(event);
    return rows.find((row) => bucketOf(row).key === key) ?? null;
  }

  // The log root is not a row, so the path starts at the outermost frame below it.
  const path: LogEvent[] = [];
  for (let node: LogEvent | null = event; node?.parent; node = node.parent) {
    path.push(node);
  }
  path.reverse();

  let currentRows = rows;
  let matched: RowComponent | null = null;
  for (let depth = 0; depth < path.length; depth++) {
    const key = getEventKey(path[depth]!);
    const next = currentRows.find((row) => bucketOf(row).key === key);
    if (!next) {
      break;
    }
    matched = next;
    if (depth === path.length - 1) {
      break;
    }
    let children = matched.getTreeChildren() ?? [];
    if (!children.length && bucketOf(matched)._children?.length && !matched.isTreeExpanded()) {
      matched.treeExpand();
      await waitForRender();
      children = matched.getTreeChildren() ?? [];
    }
    currentRows = children;
  }
  return matched;
}
