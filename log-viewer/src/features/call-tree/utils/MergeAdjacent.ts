/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent, SelfTotal } from 'apex-log-parser';

/**
 * Default gap threshold in nanoseconds (100ms)
 * Events within this gap are considered adjacent
 */
const DEFAULT_GAP_THRESHOLD_NS = 100_000_000;

/**
 * Minimum percentage of total merged duration for dynamic gap threshold
 */
const GAP_THRESHOLD_PERCENTAGE = 0.01; // 1%

/**
 * Represents a row in the call tree with potential merging
 */
export interface MergedCalltreeRow {
  id: string;
  originalData: LogEvent;
  _children: MergedCalltreeRow[] | undefined | null;
  text: string;
  namespace: string;
  duration: SelfTotal;
  dmlCount: SelfTotal;
  soqlCount: SelfTotal;
  dmlRowCount: SelfTotal;
  soqlRowCount: SelfTotal;
  totalThrownCount: number;
  /** Whether this row represents merged events */
  isMerged: boolean;
  /** Number of events merged into this row (alias for mergeCount) */
  callCount: number;
  /** Number of events merged into this row */
  mergeCount: number;
  /** Original events for expansion (only populated for merged rows) */
  mergedEvents: LogEvent[];
  /** Duration statistics for merged rows */
  durationRange?: { min: number; max: number; avg: number };
  /** Average self time per call */
  avgSelfTime: number;
}

/**
 * Generates a signature key for matching adjacent events
 * Events with the same key can be merged if adjacent
 */
export function getSignatureKey(event: LogEvent): string {
  return `${event.type ?? ''}|${event.text}|${event.lineNumber ?? ''}|${event.namespace}`;
}

/**
 * Determines if two events are close enough to be considered adjacent
 */
function isWithinGapThreshold(
  event1: LogEvent,
  event2: LogEvent,
  thresholdNs: number = DEFAULT_GAP_THRESHOLD_NS,
): boolean {
  const event1End = event1.exitStamp ?? event1.timestamp;
  const gap = event2.timestamp - event1End;
  return gap >= 0 && gap <= thresholdNs;
}

/**
 * Creates a merged row from a group of adjacent events
 */
function createMergedRow(events: LogEvent[], index: number): MergedCalltreeRow {
  const firstEvent = events[0]!;
  const totalDuration = events.reduce((sum, e) => sum + e.duration.total, 0);
  const totalSelfTime = events.reduce((sum, e) => sum + e.duration.self, 0);
  const totalDmlCount = events.reduce((sum, e) => sum + e.dmlCount.total, 0);
  const totalSoqlCount = events.reduce((sum, e) => sum + e.soqlCount.total, 0);
  const totalDmlRowCount = events.reduce((sum, e) => sum + e.dmlRowCount.total, 0);
  const totalSoqlRowCount = events.reduce((sum, e) => sum + e.soqlRowCount.total, 0);
  const totalThrownCount = events.reduce((sum, e) => sum + e.totalThrownCount, 0);

  const durations = events.map((e) => e.duration.total);
  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);
  const avgDuration = totalDuration / events.length;

  // Create merged children from all events' children
  const allChildren: LogEvent[] = [];
  for (const event of events) {
    allChildren.push(...event.children);
  }
  const mergedChildren = allChildren.length > 0 ? toMergedCallTree(allChildren) : null;

  const callCount = events.length;
  const avgSelfTime = callCount > 0 ? totalSelfTime / callCount : 0;

  return {
    id: `merged-${firstEvent.timestamp}-${index}`,
    originalData: firstEvent,
    _children: mergedChildren,
    text: firstEvent.text,
    namespace: firstEvent.namespace,
    duration: { self: totalSelfTime, total: totalDuration },
    dmlCount: { self: totalDmlCount, total: totalDmlCount },
    soqlCount: { self: totalSoqlCount, total: totalSoqlCount },
    dmlRowCount: { self: totalDmlRowCount, total: totalDmlRowCount },
    soqlRowCount: { self: totalSoqlRowCount, total: totalSoqlRowCount },
    totalThrownCount,
    isMerged: true,
    callCount,
    mergeCount: callCount,
    mergedEvents: events,
    durationRange: { min: minDuration, max: maxDuration, avg: avgDuration },
    avgSelfTime,
  };
}

/**
 * Creates a non-merged row from a single event
 */
function createSingleRow(event: LogEvent, index: number): MergedCalltreeRow {
  const children = event.children.length > 0 ? toMergedCallTree(event.children) : null;

  return {
    id: `${event.timestamp}-${index}`,
    originalData: event,
    _children: children,
    text: event.text,
    namespace: event.namespace,
    duration: event.duration,
    dmlCount: event.dmlCount,
    soqlCount: event.soqlCount,
    dmlRowCount: event.dmlRowCount,
    soqlRowCount: event.soqlRowCount,
    totalThrownCount: event.totalThrownCount,
    isMerged: false,
    callCount: 1,
    mergeCount: 1,
    mergedEvents: [],
    avgSelfTime: event.duration.self,
  };
}

/**
 * Converts log events to call tree rows with adjacent event merging
 */
export function toMergedCallTree(nodes: LogEvent[]): MergedCalltreeRow[] | undefined {
  const len = nodes.length;
  if (!len) {
    return undefined;
  }

  const results: MergedCalltreeRow[] = [];
  let i = 0;

  while (i < len) {
    const currentEvent = nodes[i]!;
    const currentKey = getSignatureKey(currentEvent);

    // Look for adjacent events with the same signature
    const adjacentGroup: LogEvent[] = [currentEvent];
    let j = i + 1;

    while (j < len) {
      const nextEvent = nodes[j]!;
      const nextKey = getSignatureKey(nextEvent);

      // Check if same signature and within gap threshold
      if (
        nextKey === currentKey &&
        isWithinGapThreshold(adjacentGroup[adjacentGroup.length - 1]!, nextEvent)
      ) {
        adjacentGroup.push(nextEvent);
        j++;
      } else {
        break;
      }
    }

    // Only merge if we have at least 2 adjacent events
    if (adjacentGroup.length >= 2) {
      results.push(createMergedRow(adjacentGroup, results.length));
    } else {
      results.push(createSingleRow(currentEvent, results.length));
    }

    i = j;
  }

  return results;
}

/**
 * Converts log events to call tree rows without merging (regular view)
 */
export function toUnmergedCallTree(nodes: LogEvent[]): MergedCalltreeRow[] | undefined {
  const len = nodes.length;
  if (!len) {
    return undefined;
  }

  const results: MergedCalltreeRow[] = [];
  for (let i = 0; i < len; ++i) {
    const node = nodes[i]!;
    results.push(createSingleRow(node, i));
  }
  return results;
}
