/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

jest.mock('../../../core/messaging/VSCodeExtensionMessenger.js', () => ({
  VSCodeExtensionMessenger: {
    listen: jest.fn(() => jest.fn()),
  },
  vscodeMessenger: {
    request: jest.fn(() => Promise.reject(new Error('No extension host to answer "fetchLog"'))),
  },
}));

jest.mock('../AppHeader.js', () => ({}));
jest.mock('../../../components/LogInspector.js', () => ({}));

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { LogViewer } from '../LogViewer.js';

const requestMock = vscodeMessenger.request as jest.Mock;

describe('LogViewer', () => {
  it('surfaces a fetchLog request failure', async () => {
    const viewer = new LogViewer();

    await Promise.resolve();
    await Promise.resolve();

    expect(requestMock).toHaveBeenCalledWith('fetchLog');
    expect(viewer.logProblems).toEqual([
      expect.objectContaining({
        summary: 'Could not load log',
        message: 'No extension host to answer "fetchLog"',
        severity: 'error',
      }),
    ]);
  });
});
