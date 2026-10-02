/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';
import type { LogCategory } from '@apexdevtools/apex-log-parser/types';

/** A frame spanning `duration` from `timestamp`, all of it self time. */
export function timelineEvent(
  timestamp: number,
  duration: number,
  category: LogCategory = 'Apex',
  children: LogEvent[] = [],
): LogEvent {
  return {
    timestamp,
    exitStamp: timestamp + duration,
    duration: { total: duration, self: duration, netSelf: duration },
    category,
    type: 'METHOD_ENTRY',
    text: `Event at ${timestamp}`,
    children,
  } as unknown as LogEvent;
}

/** Every category's buckets in one list. */
export function getAllBuckets<T>(bucketsMap: Map<string, T[]>): T[] {
  const allBuckets: T[] = [];
  for (const buckets of bucketsMap.values()) {
    allBuckets.push(...buckets);
  }
  return allBuckets;
}

/** The bucket count across every category. */
export function countBuckets(bucketsMap: Map<string, unknown[]>): number {
  let count = 0;
  for (const buckets of bucketsMap.values()) {
    count += buckets.length;
  }
  return count;
}
