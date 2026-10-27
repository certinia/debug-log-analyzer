/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Factory functions for building test data in lana tests.
 */

import { parse, type ApexLog } from '@apexdevtools/apex-log-parser';

import type { Context } from '../../Context.js';
import {
  commands,
  createMockExtensionContext,
  type MockExtensionContext,
} from '../mocks/vscode.js';

/** A log line stamped `ns` nanoseconds. */
export const logLine = (ns: number, line: string): string => `09:18:22.6 (${ns})|${line}`;

/** `lines` parsed as one log, so a test reads the parser's real events. */
export function parseLines(lines: readonly string[]): Promise<ApexLog> {
  return parse(lines.join('\n'));
}

/** A stand-in log for a test that only needs one to exist. */
export function createMockApexLog(): ApexLog {
  return { size: 0 } as ApexLog;
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

export function asContext(mock: MockContext): Context {
  return mock as unknown as Context;
}

/**
 * A command registers on apply, so the last call is the one the case just made.
 * Every handler is `Command.run`, which is why one signature covers them all.
 *
 * Reads the shared mock by path, so a suite that calls `jest.mock('vscode')` gets
 * an automock this cannot see, and the throw below names the wrong cause.
 */
export function lastRegisteredCommand(): (...args: unknown[]) => Promise<unknown> {
  const handler = commands.registerCommand.mock.calls.at(-1)?.[1];
  if (!handler) {
    throw new Error('no command registered - did the case call apply()?');
  }
  return handler as (...args: unknown[]) => Promise<unknown>;
}
