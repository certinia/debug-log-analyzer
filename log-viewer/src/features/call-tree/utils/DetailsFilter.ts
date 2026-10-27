/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { type EventType, eventType } from '@apexdevtools/apex-log-parser';

/**
 * Detail types the top-down views always show: exceptions, fatal errors, and the
 * types that report governor figures. Two of those are parents, but they count as
 * details, never as frames.
 */
const PINNED_TYPES: readonly EventType[] = [
  // Parser 0.3 marked these two `discontinuity`; 0.4 does not export that flag.
  'EXCEPTION_THROWN',
  'FATAL_ERROR',
  'CUMULATIVE_LIMIT_USAGE',
  'LIMIT_USAGE_FOR_NS',
  'CUMULATIVE_PROFILING',
  'CUMULATIVE_PROFILING_BEGIN',
];

const PINNED_TYPE_IDS: ReadonlySet<number> = new Set(
  PINNED_TYPES.map((type) => eventType(type).typeId),
);

/**
 * What an event is to the call-tree views, from its type alone and never its time.
 * A `frame` can hold children. A `pinned` detail is an exception, a fatal error or
 * a limit or profiling block, which the top-down views always show. Any other
 * `detail` shows only when the Details filter is on.
 */
export type EventKind = 'frame' | 'pinned' | 'detail';

/** The {@link EventKind} of an event of type `typeId`, a value of `columns.type`. */
export function eventKind(typeId: number, isFrame: boolean): EventKind {
  if (PINNED_TYPE_IDS.has(typeId)) {
    return 'pinned';
  }
  return isFrame ? 'frame' : 'detail';
}
