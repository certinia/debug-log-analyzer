/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';
import { outermostEvents } from '../../../core/utility/EventTree.js';
import type { Metric } from '../../analysis/services/RowGrouper.js';

/**
 * Sums `duration.total` over the union of `eventGroups`, counting each event only
 * when no ancestor of that event is also in the union. This prevents double-counting
 * when multiple events from the same call chain are present in the filtered set.
 *
 * Used by both AnalysisView (rows = `Metric` with `nodes`) and BottomUpTable (rows
 * = `BottomUpRow` with `instances`).
 */
export function sumTotalForRootEvents(
  eventGroups: Iterable<LogEvent[]>,
  valueOf: (node: LogEvent) => number,
): number {
  return outermostEvents(flatten(eventGroups)).reduce((total, node) => total + valueOf(node), 0);
}

/** The groups as one stream, so nothing is copied into an array on the way. */
function* flatten(eventGroups: Iterable<LogEvent[]>): Iterable<LogEvent> {
  for (const group of eventGroups) {
    yield* group;
  }
}

/** {@link sumTotalForRootEvents} specialised to `duration.total` (the original behaviour). */
export function sumDurationTotalForRootEvents(eventGroups: Iterable<LogEvent[]>): number {
  return sumTotalForRootEvents(eventGroups, (node) => node.duration.total);
}

/**
 * Tabulator `bottomCalc` adapter for AnalysisView: passes each `Metric.nodes` array
 * to {@link sumDurationTotalForRootEvents}. See that helper for the algorithm.
 */
export function sumRootNodesOnly(_values: number[], data: Metric[], _calcParams: unknown): number {
  return sumDurationTotalForRootEvents(data.map((row) => row.nodes));
}
