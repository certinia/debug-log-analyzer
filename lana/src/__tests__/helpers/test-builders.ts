/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Factory functions for building test data in lana tests.
 */

import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import { createMockExtensionContext, type MockExtensionContext } from '../mocks/vscode.js';

/** Widen as `lana` reads more: a field absent here is `undefined` on the mock, not a type error. */
type PartialLogEvent = Partial<
  Pick<
    LogEvent,
    | 'children'
    | 'dmlCount'
    | 'dmlRowCount'
    | 'duration'
    | 'exitStamp'
    | 'soqlCount'
    | 'soqlRowCount'
    | 'text'
    | 'thrownCount'
    | 'timestamp'
    | 'type'
  >
>;

/**
 * Creates a mock LogEvent with sensible defaults.
 * All properties are optional - specify only what you need for the test.
 */
export function createMockLogEvent(overrides: PartialLogEvent = {}): LogEvent {
  const base = {
    children: [],
    type: 'METHOD_ENTRY',
    text: 'Test Event',
    timestamp: 1000000,
    exitStamp: 2000000,
    duration: { self: 1000000, total: 1000000 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    thrownCount: { self: 0, total: 0 },
  } satisfies PartialLogEvent;

  return { ...base, ...overrides } as LogEvent;
}

type PartialApexLog = Partial<Pick<ApexLog, 'children' | 'size'>>;

/**
 * Creates a mock ApexLog with sensible defaults.
 * Useful for testing components that work with parsed log data.
 */
export function createMockApexLog(overrides: PartialApexLog = {}): ApexLog {
  const base = {
    children: [],
    size: 0,
  } satisfies PartialApexLog;

  return { ...base, ...overrides } as ApexLog;
}

/**
 * Mock Display object for Context.
 */
export interface MockDisplay {
  output: jest.Mock;
  showErrorMessage: jest.Mock;
  showFile: jest.Mock;
  showInformationMessage: jest.Mock;
  showWarningMessage: jest.Mock;
}

export function createMockDisplay(): MockDisplay {
  return {
    output: jest.fn(),
    showErrorMessage: jest.fn(),
    showFile: jest.fn(),
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
  workspaceManager?: unknown;
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
