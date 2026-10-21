/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { DebugLevels, LogLevel } from '@apexdevtools/apex-log-parser';

/**
 * What each debug level adds to the log over the level below it, per category, from the
 * Salesforce debug log event table. A level that adds no events has no entry.
 */
export const LEVEL_ADDS: Readonly<
  Record<keyof DebugLevels, Readonly<Partial<Record<LogLevel, string>>>>
> = {
  apexCode: {
    ERROR: 'Code units, errors',
    INFO: 'Exceptions, emails, cache',
    DEBUG: 'Debug statements',
    FINE: 'Methods',
    FINER: 'Statements, heap, formulas',
    FINEST: 'Variables',
  },
  // Salesforce writes namespace limit usage inside the INFO limit block, though its docs say FINEST.
  apexProfiling: {
    INFO: 'Governor limits',
    FINE: 'Profiling summary, variables',
    FINEST: 'Limit usage',
  },
  callout: {
    ERROR: 'External data errors',
    INFO: 'Callouts',
    FINER: 'Callout details',
  },
  dataAccess: {
    FINE: 'Access checks',
    FINER: 'Policy rules',
  },
  database: {
    INFO: 'Queries and DML',
    FINEST: 'Query plans',
  },
  nba: {
    ERROR: 'Errors',
    FINE: 'Strategies',
  },
  system: {
    INFO: 'System mode, duplicates',
    DEBUG: 'Duplicate details',
    FINE: 'System methods',
  },
  validation: {
    INFO: 'Validation rules',
  },
  visualforce: {
    INFO: 'View state',
    FINER: 'Page formulas',
  },
  wave: {},
  workflow: {
    ERROR: 'Flow errors',
    WARN: 'Flow faults',
    INFO: 'Flows, workflow rules, approvals',
    FINE: 'Flow elements',
    FINER: 'Flow limit usage, details',
  },
};
