/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { commands, Uri } from 'vscode';

import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { fileOrFolderExists } from '../../fs/workspaceFs.js';
import { LogView } from '../LogView.js';
import { ShowLogAnalysis } from '../ShowLogAnalysis.js';

jest.mock('../../fs/workspaceFs.js', () => ({ fileOrFolderExists: jest.fn() }));
jest.mock('../LogView.js', () => ({ LogView: { createView: jest.fn() } }));

const mockFileOrFolderExists = fileOrFolderExists as jest.Mock;
const mockCreateView = LogView.createView as jest.Mock;
const mockRegisterCommand = commands.registerCommand as jest.Mock;

describe('ShowLogAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileOrFolderExists.mockResolvedValue(true);
    mockCreateView.mockResolvedValue(undefined);
  });

  const command = (): ((uri: unknown) => Promise<unknown>) =>
    mockRegisterCommand.mock.calls[mockRegisterCommand.mock.calls.length - 1]?.[1];

  it('opens the log passed to it', async () => {
    const context = createMockContext();
    ShowLogAnalysis.apply(context as unknown as import('../../Context.js').Context);

    await command()(Uri.parse('memfs:/logs/a.log'));

    expect(mockCreateView).toHaveBeenCalled();
    expect(context.display.showErrorMessage).not.toHaveBeenCalled();
  });

  it('reports a failure to open the log rather than failing silently', async () => {
    mockCreateView.mockRejectedValue(new Error('viewer is missing'));
    const context = createMockContext();
    ShowLogAnalysis.apply(context as unknown as import('../../Context.js').Context);

    await expect(command()(Uri.parse('memfs:/logs/a.log'))).resolves.toBeUndefined();

    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error showing logfile: viewer is missing',
    );
  });
});
