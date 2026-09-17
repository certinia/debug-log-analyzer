/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits, Limits } from '@apexdevtools/apex-log-parser/types';

import type {
  HeatStripEvent,
  HeatStripTimeSeries,
} from '../../features/timeline/types/flamechart.types.js';
import { limitValue } from '../logOverviewMetrics.js';

export { limitValue };

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
  soqlQueries: limitValue(0, 0),
  soslQueries: limitValue(0, 0),
  queryRows: limitValue(0, 0),
  dmlStatements: limitValue(0, 0),
  publishImmediateDml: limitValue(0, 0),
  dmlRows: limitValue(0, 0),
  cpuTime: limitValue(0, 0),
  heapSize: limitValue(0, 0),
  callouts: limitValue(0, 0),
  emailInvocations: limitValue(0, 0),
  futureCalls: limitValue(0, 0),
  queueableJobsAddedToQueue: limitValue(0, 0),
  mobileApexPushCalls: limitValue(0, 0),
});

/**
 * A log's governor usage, with the metrics a test names and every other at zero. `peak` defaults to
 * the same figures as `final` — the parser derives both from the same snapshots, so they differ
 * only in `used`, and a test reading a ceiling wants them identical.
 */
export const governorLimits = (
  final: Partial<Limits> = {},
  peak: Partial<Limits> = final,
): GovernorLimits => ({
  snapshots: [],
  final: { ...emptyLimits(), ...final },
  peak: { ...emptyLimits(), ...peak },
  byNamespace: new Map(),
});
