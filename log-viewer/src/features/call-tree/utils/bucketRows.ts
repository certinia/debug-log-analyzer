/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from '@apexdevtools/apex-log-parser';
import type { RowComponent } from 'tabulator-tables';

import { getEventKey } from '../../../core/log/eventKeys.js';

interface BucketRow {
  key?: string;
}

const bucketOf = (row: RowComponent): BucketRow => row.getData() as BucketRow;

/**
 * The row a frame belongs to in a bottom-up view, which heads the frame with a
 * top-level row, so its own key finds it.
 *
 * @param rows - the view's top-level rows
 */
export function findRootBucket(rows: RowComponent[], event: LogEvent): RowComponent | null {
  const key = getEventKey(event);
  return rows.find((row) => bucketOf(row).key === key) ?? null;
}
