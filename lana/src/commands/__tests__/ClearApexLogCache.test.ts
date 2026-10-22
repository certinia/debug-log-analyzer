/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { FileType, window, workspace, type Uri } from 'vscode';

import {
  asContext,
  createMockContext,
  lastRegisteredCommand,
} from '../../__tests__/helpers/test-builders.js';
import { ClearApexLogCache } from '../ClearApexLogCache.js';

const mockFs = workspace.fs as unknown as Record<'readDirectory' | 'stat' | 'delete', jest.Mock>;
const ROOT = '/test/storage/apex-logs';

describe('ClearApexLogCache', () => {
  beforeEach(() => {
    mockFs.readDirectory.mockRejectedValue(new Error('no folder'));
    mockFs.delete.mockResolvedValue(undefined);
    ClearApexLogCache.apply(asContext(createMockContext()));
  });

  function cacheHolds(sizes: number[]) {
    mockFs.readDirectory.mockImplementation(async (uri: Uri) => {
      if (uri.path === ROOT) {
        return [['00Dorg', FileType.Directory]];
      }
      return sizes.map((_, i) => [`07L${i}.log`, FileType.File]);
    });
    mockFs.stat.mockImplementation(async (uri: Uri) => ({
      size: sizes[Number(uri.path.match(/07L(\d+)/)?.[1])] ?? 0,
      mtime: Date.now(),
    }));
  }

  it('says the cache is empty and deletes nothing', async () => {
    await lastRegisteredCommand()();

    expect(window.showInformationMessage).toHaveBeenCalledWith('The Apex log cache is empty.');
    expect(mockFs.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['Delete', 1],
    [undefined, 0],
  ])(
    'shows the size and deletes the whole cache only when confirmed: %s',
    async (answer, deletes) => {
      cacheHolds([2 * 1048576, 1048576]);
      (window.showWarningMessage as jest.Mock).mockResolvedValue(answer);

      await lastRegisteredCommand()();

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        'Delete 2 cached Apex logs (3.0 MB) for this workspace? Logs you opened in .sfdx are kept.',
        { modal: true },
        'Delete',
      );
      expect(mockFs.delete).toHaveBeenCalledTimes(deletes);
      if (deletes) {
        expect(mockFs.delete).toHaveBeenCalledWith(expect.objectContaining({ path: ROOT }), {
          recursive: true,
        });
      }
    },
  );
});
