/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  LIMIT_METRIC,
  type LimitMetricUnit,
  type Limits,
} from '@apexdevtools/apex-log-parser/types';

/** A governor metric as every surface names, orders and formats it. */
export interface GovernorMetric<K extends keyof Limits = keyof Limits> {
  key: K;
  /** The short label every surface shows. */
  label: string;
  unit: LimitMetricUnit;
  /** Metric strip order, lowest first. The strip always shows a metric below 4. */
  priority: number;
  /** How a `System.LimitException` names the metric, lower case; absent where none is known. */
  exceptionPhrase?: string;
}

/**
 * Every governor metric, keyed by `Limits`, so a new parser metric does not build until it is
 * named here. Key order is the reading order every surface lists them in.
 */
export const GOVERNOR_METRIC: { readonly [K in keyof Limits]: GovernorMetric<K> } = {
  cpuTime: {
    ...LIMIT_METRIC.cpuTime,
    label: 'CPU Time',
    priority: 0,
    exceptionPhrase: 'apex cpu time',
  },
  heapSize: {
    ...LIMIT_METRIC.heapSize,
    label: 'Heap Size',
    priority: 3,
    exceptionPhrase: 'apex heap size',
  },
  soqlQueries: {
    ...LIMIT_METRIC.soqlQueries,
    label: 'SOQL',
    priority: 1,
    exceptionPhrase: 'too many soql queries',
  },
  queryRows: {
    ...LIMIT_METRIC.queryRows,
    label: 'SOQL Rows',
    priority: 4,
    exceptionPhrase: 'too many query rows',
  },
  dmlStatements: {
    ...LIMIT_METRIC.dmlStatements,
    label: 'DML',
    priority: 2,
    exceptionPhrase: 'too many dml statements',
  },
  dmlRows: {
    ...LIMIT_METRIC.dmlRows,
    label: 'DML Rows',
    priority: 6,
    exceptionPhrase: 'too many dml rows',
  },
  soslQueries: {
    ...LIMIT_METRIC.soslQueries,
    label: 'SOSL',
    priority: 5,
    exceptionPhrase: 'too many sosl queries',
  },
  publishImmediateDml: {
    ...LIMIT_METRIC.publishImmediateDml,
    label: 'Publish Immediate DML',
    priority: 7,
  },
  callouts: {
    ...LIMIT_METRIC.callouts,
    label: 'Callouts',
    priority: 8,
    exceptionPhrase: 'too many callouts',
  },
  emailInvocations: {
    ...LIMIT_METRIC.emailInvocations,
    label: 'Email Invocations',
    priority: 9,
    exceptionPhrase: 'too many email invocations',
  },
  futureCalls: {
    ...LIMIT_METRIC.futureCalls,
    label: 'Future Calls',
    priority: 10,
    exceptionPhrase: 'too many future calls',
  },
  queueableJobsAddedToQueue: {
    ...LIMIT_METRIC.queueableJobsAddedToQueue,
    label: 'Queueable Jobs',
    priority: 11,
    exceptionPhrase: 'too many queueable jobs',
  },
  mobileApexPushCalls: {
    ...LIMIT_METRIC.mobileApexPushCalls,
    label: 'Mobile Push Calls',
    priority: 12,
  },
};

/** Every governor metric, in reading order. Ties in a ranked view fall back to this order. */
export const GOVERNOR_METRICS: readonly GovernorMetric[] = Object.values(GOVERNOR_METRIC);
