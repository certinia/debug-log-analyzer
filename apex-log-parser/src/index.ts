/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

// Parser
export { ApexLogParser, DebugLevel, parse } from './ApexLogParser.js';

// Types
export type {
  CPUType,
  DebugCategory,
  GovernorLimits,
  GovernorSnapshot,
  IssueType,
  Limits,
  LineNumber,
  LogCategory,
  LogEventType,
  LogIssue,
  LogLevel,
  LogLineConstructor,
  LogSubCategory,
  SelfTotal,
} from './types.js';

// Constants
export { ALL_LOG_CATEGORIES, DEBUG_CATEGORY, LOG_CATEGORY, LOG_LEVEL } from './types.js';

// Events - classes and utilities used by consumers
export {
  ApexLog,
  CodeUnitStartedLine,
  DMLBeginLine,
  ExecutionStartedLine,
  LogEvent,
  MethodEntryLine,
  SOQLExecuteBeginLine,
  SOQLExecuteExplainLine,
  parseObjectNamespace,
  parseRows,
  parseVfNamespace,
} from './LogEvents.js';

// Mapping
export { getLogEventClass, lineTypeMap } from './LogLineMapping.js';
