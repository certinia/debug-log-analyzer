/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { commands } from 'vscode';

import type { Context } from '../../Context.js';
import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { LogView } from '../LogView.js';
import { ShowInLogAnalysis } from '../ShowInLogAnalysis.js';

jest.mock('../LogView.js', () => ({
  LogView: {
    createView: jest.fn(),
    getCurrentView: jest.fn(),
    getLogUri: jest.fn(),
    setPendingNavigation: jest.fn(),
  },
}));

const mockCreateView = LogView.createView as jest.Mock;
const mockGetCurrentView = LogView.getCurrentView as jest.Mock;
const mockRegisterCommand = commands.registerCommand as jest.Mock;

describe('ShowInLogAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentView.mockReturnValue(undefined);
    mockCreateView.mockResolvedValue(undefined);
  });

  const command = (): ((args: unknown) => Promise<unknown>) =>
    mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1]?.[1];

  it('opens the log at the timestamp', async () => {
    const context = createMockContext();
    ShowInLogAnalysis.apply(context as unknown as Context);

    await command()({ timestamp: 42, filePath: 'memfs:/logs/a.log' });

    expect(LogView.setPendingNavigation).toHaveBeenCalledWith(42);
    expect(mockCreateView).toHaveBeenCalled();
    expect(context.display.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reports a failure to open the log rather than failing silently', async () => {
    mockCreateView.mockRejectedValue(new Error('viewer is missing'));
    const context = createMockContext();
    ShowInLogAnalysis.apply(context as unknown as Context);

    await expect(
      command()({ timestamp: 42, filePath: 'memfs:/logs/a.log' }),
    ).resolves.toBeUndefined();

    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error showing the log analysis: viewer is missing',
    );
  });
});
