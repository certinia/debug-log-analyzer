/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { window } from 'vscode';

import { memoryFs } from '../../__tests__/helpers/memoryFs.js';
import {
  asContext,
  createMockContext,
  lastRegisteredCommand,
} from '../../__tests__/helpers/test-builders.js';
import { ClearApexLogCache } from '../ClearApexLogCache.js';

const ROOT = '/test/storage/apex-logs';
const MB = 1048576;

describe('ClearApexLogCache', () => {
  let fs: ReturnType<typeof memoryFs>;

  beforeEach(() => {
    fs = memoryFs();
    ClearApexLogCache.apply(asContext(createMockContext()));
  });

  it('says the cache is empty', async () => {
    await lastRegisteredCommand()();

    expect(window.showInformationMessage).toHaveBeenCalledWith('The Apex log cache is empty.');
    expect(window.showWarningMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['Delete', []],
    [undefined, [`${ROOT}/00Da/1.log`, `${ROOT}/00Db/2.log`]],
  ])(
    'shows the size of every org and clears them all only when confirmed: %s',
    async (answer, left) => {
      fs.put(`${ROOT}/00Da/1.log`, 'a'.repeat(2 * MB));
      fs.put(`${ROOT}/00Db/2.log`, 'b'.repeat(MB));
      (window.showWarningMessage as jest.Mock).mockResolvedValue(answer);

      await lastRegisteredCommand()();

      expect(window.showWarningMessage).toHaveBeenCalledWith(
        'Delete 2 cached Apex logs (3.0 MB) for this workspace? Logs you opened in .sfdx are kept.',
        { modal: true },
        'Delete',
      );
      expect(fs.paths()).toEqual(left);
    },
  );
});
