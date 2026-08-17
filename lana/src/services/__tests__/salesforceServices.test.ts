/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { Uri } from 'vscode';

const mockFsService = {
  readFile: jest.fn(),
  safeWriteFile: jest.fn(),
  fileOrFolderExists: jest.fn(),
};
const mockRunPromise = jest.fn((effect: unknown) => Promise.resolve(effect));

jest.mock('../servicesRuntime.js', () => ({
  getServicesApi: () => ({ services: { FsService: mockFsService } }),
  getRuntime: () => ({ runPromise: mockRunPromise }),
}));

import { fileOrFolderExists, readFile, writeFile } from '../salesforceServices.js';

describe('salesforceServices filesystem adapters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes a virtual filesystem URI directly to FsService', async () => {
    const uri = Uri.parse('memfs:/test/workspace/log.log');
    mockFsService.readFile.mockReturnValueOnce('log content');
    mockFsService.safeWriteFile.mockReturnValueOnce(undefined);
    mockFsService.fileOrFolderExists.mockReturnValueOnce(true);

    await expect(readFile(uri)).resolves.toBe('log content');
    await expect(writeFile(uri, 'updated log')).resolves.toBeUndefined();
    await expect(fileOrFolderExists(uri)).resolves.toBe(true);

    expect(mockFsService.readFile).toHaveBeenCalledWith(uri);
    expect(mockFsService.safeWriteFile).toHaveBeenCalledWith(uri, 'updated log');
    expect(mockFsService.fileOrFolderExists).toHaveBeenCalledWith(uri);
  });
});
