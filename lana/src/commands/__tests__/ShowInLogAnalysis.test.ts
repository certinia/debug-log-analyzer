/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import {
  asContext,
  createMockContext,
  lastRegisteredCommand,
} from '../../__tests__/helpers/test-builders.js';
import { LogView } from '../LogView.js';
import { ShowInLogAnalysis } from '../ShowInLogAnalysis.js';

vi.mock('../LogView.js', () => ({
  LogView: {
    createView: vi.fn(),
    getCurrentView: vi.fn(),
    getLogUri: vi.fn(),
    setPendingNavigation: vi.fn(),
  },
}));

const mockCreateView = LogView.createView as Mock;
const mockGetCurrentView = LogView.getCurrentView as Mock;

describe('ShowInLogAnalysis', () => {
  beforeEach(() => {
    mockGetCurrentView.mockReturnValue(undefined);
    mockCreateView.mockResolvedValue(undefined);
  });

  const command = lastRegisteredCommand;

  it('opens the log at the timestamp', async () => {
    const context = createMockContext();
    ShowInLogAnalysis.apply(asContext(context));

    await command()({ timestamp: 42, filePath: 'memfs:/logs/a.log' });

    expect(LogView.setPendingNavigation).toHaveBeenCalledWith(42);
    expect(mockCreateView).toHaveBeenCalled();
    expect(context.display.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reports a failure to open the log rather than failing silently', async () => {
    mockCreateView.mockRejectedValue(new Error('viewer is missing'));
    const context = createMockContext();
    ShowInLogAnalysis.apply(asContext(context));

    await expect(
      command()({ timestamp: 42, filePath: 'memfs:/logs/a.log' }),
    ).resolves.toBeUndefined();

    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error showing the log analysis: viewer is missing',
    );
  });
});
