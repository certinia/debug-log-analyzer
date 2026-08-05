/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Limits } from 'apex-log-parser';

import type {
  HeatStripEvent,
  HeatStripTimeSeries,
} from '../../features/timeline/types/flamechart.types.js';

/** One dense-series event holding only the metrics a test cares about. */
export const seriesEvent = (
  timestamp: number,
  values: Record<string, { used: number; limit: number }>,
): HeatStripEvent => ({
  timestamp,
  namespace: 'combined',
  values: new Map(Object.entries(values)),
});

/** A metric-strip time series carrying just the given events. */
export const timeSeries = (events: HeatStripEvent[] = []): HeatStripTimeSeries => ({
  metrics: new Map(),
  events,
});

/** Every governor metric at zero, for a test to set only the ones it cares about. */
export const emptyLimits = (): Limits => ({
  soqlQueries: { used: 0, limit: 0 },
  soslQueries: { used: 0, limit: 0 },
  queryRows: { used: 0, limit: 0 },
  dmlStatements: { used: 0, limit: 0 },
  publishImmediateDml: { used: 0, limit: 0 },
  dmlRows: { used: 0, limit: 0 },
  cpuTime: { used: 0, limit: 0 },
  heapSize: { used: 0, limit: 0 },
  callouts: { used: 0, limit: 0 },
  emailInvocations: { used: 0, limit: 0 },
  futureCalls: { used: 0, limit: 0 },
  queueableJobsAddedToQueue: { used: 0, limit: 0 },
  mobileApexPushCalls: { used: 0, limit: 0 },
});
