/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { commands } from 'vscode';

import type { Context } from '../../Context.js';
import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { Command } from '../Command.js';

const mockRegisterCommand = commands.registerCommand as jest.Mock;

describe('Command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns what the handler returns', async () => {
    const context = createMockContext();
    const command = new Command(
      'aCommand',
      'A Command',
      context as unknown as Context,
      'Error running the command',
      () => Promise.resolve('a result'),
    );

    await expect(command.run()).resolves.toBe('a result');
    expect(context.display.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reports a rejected handler rather than failing silently', async () => {
    const context = createMockContext();
    const command = new Command(
      'aCommand',
      'A Command',
      context as unknown as Context,
      'Error running the command',
      () => Promise.reject(new Error('it broke')),
    );

    await expect(command.run()).resolves.toBeUndefined();
    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error running the command: it broke',
    );
  });

  it('reports a handler that throws synchronously', async () => {
    const context = createMockContext();
    const command = new Command(
      'aCommand',
      'A Command',
      context as unknown as Context,
      'Error running the command',
      () => {
        throw new Error('it broke');
      },
    );

    await expect(command.run()).resolves.toBeUndefined();
    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error running the command: it broke',
    );
  });

  it('registers the guarded handler, not the raw one', async () => {
    const context = createMockContext();
    new Command(
      'aCommand',
      'A Command',
      context as unknown as Context,
      'Error running the command',
      () => Promise.reject(new Error('it broke')),
    ).register();

    const [name, registered] = mockRegisterCommand.mock.calls[0] as [
      string,
      (...args: unknown[]) => Promise<unknown>,
    ];
    expect(name).toBe('lana.aCommand');
    await expect(registered()).resolves.toBeUndefined();
    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error running the command: it broke',
    );
  });
});
