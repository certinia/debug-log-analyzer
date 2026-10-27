/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from '@apexdevtools/apex-log-parser';

/**
 * Detail types that report governor figures. Two of them are parents, but they
 * count as details, never as frames.
 */
const PINNED_TYPES: ReadonlySet<string> = new Set<string>([
  'CUMULATIVE_LIMIT_USAGE',
  'LIMIT_USAGE_FOR_NS',
  'CUMULATIVE_PROFILING',
  'CUMULATIVE_PROFILING_BEGIN',
]);

/**
 * What an event is to the call-tree views, from its type alone and never its time.
 * A `frame` can hold children. A `pinned` detail is an exception, a fatal error or
 * a {@link PINNED_TYPES} event, which the top-down views always show. Any other
 * `detail` shows only when the Details filter is on.
 */
export type EventKind = 'frame' | 'pinned' | 'detail';

/** The {@link EventKind} of `event`. */
export function eventKind(event: Pick<LogEvent, 'type' | 'isParent' | 'discontinuity'>): EventKind {
  if (event.discontinuity || PINNED_TYPES.has(event.type ?? '')) {
    return 'pinned';
  }
  return event.isParent ? 'frame' : 'detail';
}
