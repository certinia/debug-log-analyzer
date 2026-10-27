/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { EVENT_TYPES, type EventType } from '@apexdevtools/apex-log-parser';

import type { LogIndex } from '#core/log/LogIndex.js';

/**
 * Detail types the top-down views always show: exceptions, fatal errors, and the
 * types that report governor figures. Two of those are parents, but they count as
 * details, never as frames.
 */
const PINNED_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  // Parser 0.3 marked these two `discontinuity`; 0.4 does not export that flag.
  'EXCEPTION_THROWN',
  'FATAL_ERROR',
  'CUMULATIVE_LIMIT_USAGE',
  'LIMIT_USAGE_FOR_NS',
  'CUMULATIVE_PROFILING',
  'CUMULATIVE_PROFILING_BEGIN',
]);

/**
 * What an event is to the call-tree views, from its type alone and never its time.
 * A `frame` can hold children. A `pinned` detail is an exception, a fatal error or
 * a limit or profiling block, which the top-down views always show. Any other
 * `detail` shows only when the Details filter is on.
 */
export type EventKind = 'frame' | 'pinned' | 'detail';

// By type, not `columns.isFrame`: a VF call with no method is a frame here, as in parser 0.3.
const KIND_BY_TYPE_ID: readonly EventKind[] = EVENT_TYPES.map(({ type, shape }) =>
  PINNED_TYPES.has(type) ? 'pinned' : shape === 'frame' ? 'frame' : 'detail',
);

const KIND_BY_TYPE: ReadonlyMap<string, EventKind> = new Map(
  EVENT_TYPES.map(({ type, typeId }) => [type, KIND_BY_TYPE_ID[typeId]!]),
);

/** The {@link EventKind} of an event of type `type`. */
export function eventKind(type: string): EventKind {
  return KIND_BY_TYPE.get(type) ?? 'detail';
}

/** The {@link EventKind} of each row of `index`, by row. */
export function rowKinds(index: LogIndex): (row: number) => EventKind {
  const types = index.column(index.log.columns.type);
  return (row) => KIND_BY_TYPE_ID[types[row]!]!;
}
