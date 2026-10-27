/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent, ApexLog } from '@apexdevtools/apex-log-parser';

import { AGGREGATED_WITHOUT_DETAILS } from '../../src/features/call-tree/grid/columns.js';
import type { TimeOrderRow } from './timeOrderTree.js';
import type { RowFilter } from '../../src/grid/core/index.js';

export const timeOrderDetails: RowFilter<TimeOrderRow> = AGGREGATED_WITHOUT_DETAILS;

/** The deepest event in the middle of the log: the worst go-to-row a user can ask for. */
export function deepEvent(log: ApexLog): LogEvent {
  const all: { event: LogEvent; depth: number }[] = [];
  const stack = log.children.map((event) => ({ event, depth: 0 }));
  for (let item = stack.pop(); item; item = stack.pop()) {
    all.push(item);
    for (const child of item.event.children) {
      stack.push({ event: child, depth: item.depth + 1 });
    }
  }
  all.sort((a, b) => a.event.eventIndex - b.event.eventIndex);
  const middle = all.slice(Math.floor(all.length * 0.45), Math.floor(all.length * 0.55));
  return middle.reduce((a, b) => (b.depth > a.depth ? b : a)).event;
}

/** The event indexes from the root down to `event`, as Time Order rows are keyed. */
export function pathOf(event: LogEvent): number[] {
  const path: number[] = [];
  for (let e: LogEvent | null = event; e?.parent; e = e.parent) {
    path.push(e.eventIndex);
  }
  return path.reverse();
}
