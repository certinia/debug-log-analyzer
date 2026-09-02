/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as EffectContext from 'effect/Context';
import { commands, extensions, window } from 'vscode';

import {
  disposeServices,
  ensureServicesAvailable,
  isSalesforceServicesApi,
} from '../servicesRuntime.js';

const mockGetExtension = extensions.getExtension as jest.Mock;
const mockShowErrorMessage = window.showErrorMessage as jest.Mock;
const mockExecuteCommand = commands.executeCommand as jest.Mock;

const validApi = () => ({
  services: {
    prebuiltServicesDependencies: EffectContext.empty(),
    ApexLogService: {
      listLogs: jest.fn(),
      getLogBody: jest.fn(),
    },
    FsService: {
      readFile: jest.fn(),
      safeWriteFile: jest.fn(),
      fileOrFolderExists: jest.fn(),
    },
  },
});

describe('servicesRuntime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetExtension.mockReturnValue(undefined);
    mockShowErrorMessage.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await disposeServices();
  });

  it('recognizes the required Salesforce Services API shape', () => {
    expect(isSalesforceServicesApi(validApi())).toBe(true);
  });

  it.each([
    undefined,
    {},
    { services: {} },
    { services: { prebuiltServicesDependencies: {}, ApexLogService: {} } },
  ])('rejects an incompatible API shape', (api) => {
    expect(isSalesforceServicesApi(api)).toBe(false);
  });

  it('offers to install Salesforce Services when it is missing', async () => {
    mockShowErrorMessage.mockResolvedValue('Install or Update Salesforce Services');

    await expect(ensureServicesAvailable()).resolves.toBe(false);

    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('required to retrieve Apex logs'),
      'Install or Update Salesforce Services',
    );
    expect(mockExecuteCommand).toHaveBeenCalledWith(
      'workbench.extensions.installExtension',
      'salesforce.salesforcedx-vscode-services',
    );
  });

  it('reports an incompatible Salesforce Services API', async () => {
    mockGetExtension.mockReturnValue({
      isActive: true,
      exports: { services: {} },
    });

    await expect(ensureServicesAvailable()).resolves.toBe(false);

    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('does not expose the required Apex log API'),
      'Install or Update Salesforce Services',
    );
  });

  it('activates Salesforce Services once for concurrent requests', async () => {
    const activate = jest.fn().mockResolvedValue(validApi());
    mockGetExtension.mockReturnValue({ isActive: false, activate });

    await expect(
      Promise.all([ensureServicesAvailable(), ensureServicesAvailable()]),
    ).resolves.toEqual([true, true]);

    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('preserves unexpected activation failures', async () => {
    mockGetExtension.mockReturnValue({
      isActive: false,
      activate: jest.fn().mockRejectedValue(new Error('activation failed')),
    });

    await expect(ensureServicesAvailable()).rejects.toThrow('activation failed');
    expect(mockShowErrorMessage).not.toHaveBeenCalled();
  });
});
