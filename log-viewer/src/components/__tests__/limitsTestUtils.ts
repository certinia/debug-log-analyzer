/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Limits } from 'apex-log-parser';

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
