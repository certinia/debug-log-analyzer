/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { EVENT_TYPES, eventType, SHAPE, type EventType } from '@apexdevtools/apex-log-parser';

import type { LogIndex } from './LogIndex.js';

// Exceptions, fatal errors, and the cumulative limit and profiling blocks; the blocks have children but are never frames.
const PINNED_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  // Parser 0.3 marked these two `discontinuity`; 0.4 does not export that flag.
  'EXCEPTION_THROWN',
  'FATAL_ERROR',
  'CUMULATIVE_LIMIT_USAGE',
  'LIMIT_USAGE_FOR_NS',
  'CUMULATIVE_PROFILING',
  'CUMULATIVE_PROFILING_BEGIN',
]);

/** An event's role in the call-tree views, by type: a `frame`, a `pinned` detail the top-down views always show, or a `detail` shown only with Details on. */
export type EventKind = 'frame' | 'pinned' | 'detail';

// By type, not `columns.isFrame`: a VF call with no method is a frame here, as in parser 0.3.
const KIND_BY_TYPE_ID: readonly EventKind[] = EVENT_TYPES.map(({ type, shape }) =>
  PINNED_TYPES.has(type) ? 'pinned' : shape === SHAPE.Frame ? 'frame' : 'detail',
);

/** The {@link EventKind} of an event of type `type`. */
export function eventKind(type: string): EventKind {
  return KIND_BY_TYPE_ID[eventType(type as EventType)?.typeId ?? -1] ?? 'detail';
}

/** The {@link EventKind} of each row of `index`, by row. */
export function rowKinds(index: LogIndex): (row: number) => EventKind {
  const types = index.column(index.log.columns.type);
  return (row) => KIND_BY_TYPE_ID[types[row]!]!;
}
