/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Factory functions for building test data in lana tests.
 */

import type { ApexLog, LogEvent } from 'apex-log-parser';

import { createMockExtensionContext, type MockExtensionContext } from '../mocks/vscode.js';

/**
 * Partial type for creating mock LogEvent objects.
 * Only requires the fields you want to set, everything else gets defaults.
 */
type PartialLogEvent = Partial<{
  type: string | null;
  text: string;
  timestamp: number;
  exitStamp: number | null;
  children: LogEvent[];
  parent: LogEvent | null;
  duration: { self: number; total: number };
  soqlCount: { self: number; total: number };
  soqlRowCount: { self: number; total: number };
  dmlCount: { self: number; total: number };
  dmlRowCount: { self: number; total: number };
  totalThrownCount: number;
  lineNumber: number | 'EXTERNAL' | null;
  namespace: string;
  logLine: string;
  isExit: boolean;
  isParent: boolean;
  isTruncated: boolean;
}>;

/**
 * Creates a mock LogEvent with sensible defaults.
 * All properties are optional - specify only what you need for the test.
 */
export function createMockLogEvent(overrides: PartialLogEvent = {}): LogEvent {
  const base = {
    logParser: {} as unknown,
    parent: null,
    children: [],
    type: 'METHOD_ENTRY' as const,
    logLine: '',
    text: 'Test Event',
    acceptsText: false,
    isExit: false,
    isParent: false,
    isTruncated: false,
    nextLineIsExit: false,
    lineNumber: null,
    namespace: 'default',
    hasValidSymbols: false,
    suffix: null,
    discontinuity: false,
    timestamp: 1000000,
    exitStamp: 2000000,
    category: 'Method' as const,
    cpuType: 'method' as const,
    duration: { self: 1000000, total: 1000000 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    soslRowCount: { self: 0, total: 0 },
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    soslCount: { self: 0, total: 0 },
    totalThrownCount: 0,
    exitTypes: [],
    recalculateDurations: jest.fn(),
  };

  return { ...base, ...overrides } as unknown as LogEvent;
}

/**
 * Partial type for creating mock ApexLog objects.
 */
type PartialApexLog = Partial<{
  children: LogEvent[];
  timestamp: number;
  exitStamp: number;
  size: number;
  namespaces: string[];
  duration: { self: number; total: number };
}>;

/**
 * Creates a mock ApexLog with sensible defaults.
 * Useful for testing components that work with parsed log data.
 */
export function createMockApexLog(overrides: PartialApexLog = {}): ApexLog {
  const base = {
    logParser: {} as unknown,
    parent: null,
    children: [],
    type: null,
    logLine: '',
    text: 'LOG_ROOT',
    acceptsText: false,
    isExit: false,
    isParent: false,
    isTruncated: false,
    nextLineIsExit: false,
    lineNumber: null,
    namespace: '',
    hasValidSymbols: false,
    suffix: null,
    discontinuity: false,
    timestamp: 0,
    exitStamp: 0,
    category: '' as const,
    cpuType: '' as const,
    duration: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    soslRowCount: { self: 0, total: 0 },
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    soslCount: { self: 0, total: 0 },
    totalThrownCount: 0,
    exitTypes: [],
    recalculateDurations: jest.fn(),
    setTimes: jest.fn(),
    size: 0,
    debugLevels: [],
    namespaces: [],
    logIssues: [],
    parsingErrors: [],
    governorLimits: {
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
      byNamespace: new Map(),
      snapshots: [],
    },
    executionEndTime: 0,
  };

  return { ...base, ...overrides } as unknown as ApexLog;
}

/**
 * Mock Display object for Context.
 */
export interface MockDisplay {
  output: jest.Mock;
  showErrorMessage: jest.Mock;
  showInformationMessage: jest.Mock;
  showWarningMessage: jest.Mock;
}

export function createMockDisplay(): MockDisplay {
  return {
    output: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
  };
}

/**
 * Mock Context for testing command handlers and features.
 */
export interface MockContext {
  context: MockExtensionContext;
  display: MockDisplay;
  workspaces: { uri: { fsPath: string }; name: string }[];
}

/**
 * Creates a mock Context object for testing.
 * Includes mocked ExtensionContext, Display, and symbolFinder.
 */
export function createMockContext(overrides: Partial<MockContext> = {}): MockContext {
  const display = createMockDisplay();
  const context = createMockExtensionContext();

  const base: MockContext = {
    context,
    display,
    workspaces: [],
  };

  return { ...base, ...overrides };
}

/**
 * Creates a simple event tree for testing hierarchical event searches.
 * Returns parent with nested children at specified depths.
 */
export function createMockEventTree(config: {
  rootTimestamp: number;
  rootExitStamp: number;
  childConfigs?: Array<{
    timestamp: number;
    exitStamp: number;
    children?: Array<{ timestamp: number; exitStamp: number }>;
  }>;
}): LogEvent {
  const root = createMockLogEvent({
    timestamp: config.rootTimestamp,
    exitStamp: config.rootExitStamp,
    children: [],
  });

  if (config.childConfigs) {
    root.children = config.childConfigs.map((childConfig) => {
      const child = createMockLogEvent({
        timestamp: childConfig.timestamp,
        exitStamp: childConfig.exitStamp,
        parent: root,
        children: [],
      });

      if (childConfig.children) {
        child.children = childConfig.children.map((grandchildConfig) =>
          createMockLogEvent({
            timestamp: grandchildConfig.timestamp,
            exitStamp: grandchildConfig.exitStamp,
            parent: child,
          }),
        );
      }

      return child;
    });
  }

  return root;
}
