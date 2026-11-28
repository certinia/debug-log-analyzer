/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { DebugCategory, Level } from '@apexdevtools/apex-log-parser';

/**
 * What each debug level adds to the log over the level below it, per category, from the
 * level the parser gives each event type. A level that adds no events has no entry.
 */
export const LEVEL_ADDS: Readonly<Record<DebugCategory, Readonly<Partial<Record<Level, string>>>>> =
  {
    apexCode: {
      ERROR: 'Code units, errors',
      WARN: 'Warnings',
      INFO: 'Exceptions, emails, cache',
      DEBUG: 'Debug statements',
      FINE: 'Methods',
      FINER: 'Statements, heap, formulas',
      FINEST: 'Variables',
    },
    apexProfiling: {
      INFO: 'Governor limits',
      FINE: 'Profiling summary, variables',
      FINEST: 'Limit usage',
    },
    callout: {
      ERROR: 'External data errors',
      INFO: 'Callouts',
      FINER: 'Callout details',
      FINEST: 'Callout preparation',
    },
    dataAccess: {
      FINE: 'Access checks',
      FINER: 'Policy rules',
    },
    database: {
      WARN: 'Lock releases',
      INFO: 'Queries and DML',
      FINE: 'User mode permission sets',
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
      FINE: 'Apex calls',
      FINER: 'Page formulas',
    },
    wave: {
      ERROR: 'Template errors',
      INFO: 'App lifecycle',
      FINE: 'Summaries, templated assets',
      FINER: 'Rule details',
      FINEST: 'Diff details',
    },
    workflow: {
      ERROR: 'Flow errors',
      WARN: 'Flow faults',
      INFO: 'Flows, workflow rules, approvals',
      FINE: 'Flow elements',
      FINER: 'Flow limit usage, details',
    },
  };
