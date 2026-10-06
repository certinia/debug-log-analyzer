/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

// Hoisted above the import, so the mock can't close over a `const` declared here.
jest.mock('../VSCodeExtensionMessenger.js', () => ({
  vscodeMessenger: { getVsCodeAPI: jest.fn(), send: jest.fn() },
}));

import { vscodeMessenger } from '../VSCodeExtensionMessenger.js';
import { saveFile } from '../saveFile.js';

const getVsCodeAPI = vscodeMessenger.getVsCodeAPI as jest.Mock;
const send = vscodeMessenger.send as jest.Mock;

describe('saveFile', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('sends the file to the extension host and reports that it took it', () => {
    getVsCodeAPI.mockReturnValue({});

    expect(saveFile('a,b\n1,2', 'soql.csv')).toBe(true);
    expect(send).toHaveBeenCalledWith('saveFile', {
      fileContent: 'a,b\n1,2',
      options: { defaultFileName: 'soql.csv' },
    });
  });

  it('reports no host outside a webview, so the caller saves the file itself', () => {
    getVsCodeAPI.mockReturnValue(null);

    expect(saveFile('a,b\n1,2', 'soql.csv')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
