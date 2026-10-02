/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Factory functions for building test data in lana tests.
 */

import { type Mock, vi } from 'vitest';
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';

import type { Context } from '../../Context.js';
import {
  commands,
  createMockExtensionContext,
  type MockExtensionContext,
} from '../mocks/vscode.js';

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
  output: Mock;
  showErrorMessage: Mock;
  showFile: Mock;
  showInformationMessage: Mock;
  showWarningMessage: Mock;
}

export function createMockDisplay(): MockDisplay {
  return {
    output: vi.fn(),
    showErrorMessage: vi.fn(),
    showFile: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
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

export function asContext(mock: MockContext): Context {
  return mock as unknown as Context;
}

/**
 * A command registers on apply, so the last call is the one the case just made.
 * Every handler is `Command.run`, which is why one signature covers them all.
 *
 * Reads the shared mock by path, so a suite that calls `vi.mock('vscode')` gets
 * an automock this cannot see, and the throw below names the wrong cause.
 */
export function lastRegisteredCommand(): (...args: unknown[]) => Promise<unknown> {
  const handler = commands.registerCommand.mock.calls.at(-1)?.[1];
  if (!handler) {
    throw new Error('no command registered - did the case call apply()?');
  }
  return handler as (...args: unknown[]) => Promise<unknown>;
}
