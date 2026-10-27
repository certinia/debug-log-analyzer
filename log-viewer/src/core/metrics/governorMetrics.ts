/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LIMIT_METRICS, type LimitUnit, type Limits } from '@apexdevtools/apex-log-parser';

/** A governor metric as every surface names, orders and formats it. */
export interface GovernorMetric<K extends keyof Limits = keyof Limits> {
  key: K;
  /** The short label every surface shows. */
  label: string;
  unit: LimitUnit;
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
    key: 'cpuTime',
    unit: LIMIT_METRICS.cpuTime,
    label: 'CPU Time',
    priority: 0,
    exceptionPhrase: 'apex cpu time',
  },
  heapSize: {
    key: 'heapSize',
    unit: LIMIT_METRICS.heapSize,
    label: 'Heap Size',
    priority: 3,
    exceptionPhrase: 'apex heap size',
  },
  soqlQueries: {
    key: 'soqlQueries',
    unit: LIMIT_METRICS.soqlQueries,
    label: 'SOQL',
    priority: 1,
    exceptionPhrase: 'too many soql queries',
  },
  queryRows: {
    key: 'queryRows',
    unit: LIMIT_METRICS.queryRows,
    label: 'SOQL Rows',
    priority: 4,
    exceptionPhrase: 'too many query rows',
  },
  dmlStatements: {
    key: 'dmlStatements',
    unit: LIMIT_METRICS.dmlStatements,
    label: 'DML',
    priority: 2,
    exceptionPhrase: 'too many dml statements',
  },
  dmlRows: {
    key: 'dmlRows',
    unit: LIMIT_METRICS.dmlRows,
    label: 'DML Rows',
    priority: 6,
    exceptionPhrase: 'too many dml rows',
  },
  soslQueries: {
    key: 'soslQueries',
    unit: LIMIT_METRICS.soslQueries,
    label: 'SOSL',
    priority: 5,
    exceptionPhrase: 'too many sosl queries',
  },
  publishImmediateDml: {
    key: 'publishImmediateDml',
    unit: LIMIT_METRICS.publishImmediateDml,
    label: 'Publish Immediate DML',
    priority: 7,
  },
  callouts: {
    key: 'callouts',
    unit: LIMIT_METRICS.callouts,
    label: 'Callouts',
    priority: 8,
    exceptionPhrase: 'too many callouts',
  },
  emailInvocations: {
    key: 'emailInvocations',
    unit: LIMIT_METRICS.emailInvocations,
    label: 'Email Invocations',
    priority: 9,
    exceptionPhrase: 'too many email invocations',
  },
  futureCalls: {
    key: 'futureCalls',
    unit: LIMIT_METRICS.futureCalls,
    label: 'Future Calls',
    priority: 10,
    exceptionPhrase: 'too many future calls',
  },
  queueableJobsAddedToQueue: {
    key: 'queueableJobsAddedToQueue',
    unit: LIMIT_METRICS.queueableJobsAddedToQueue,
    label: 'Queueable Jobs',
    priority: 11,
    exceptionPhrase: 'too many queueable jobs',
  },
  mobileApexPushCalls: {
    key: 'mobileApexPushCalls',
    unit: LIMIT_METRICS.mobileApexPushCalls,
    label: 'Mobile Push Calls',
    priority: 12,
  },
};

/** Every governor metric, in reading order. Ties in a ranked view fall back to this order. */
export const GOVERNOR_METRICS: readonly GovernorMetric[] = Object.values(GOVERNOR_METRIC);
