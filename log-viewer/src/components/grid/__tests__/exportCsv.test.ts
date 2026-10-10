/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { exportCsv } from '../exportCsv.js';

const BOM = String.fromCharCode(0xfeff);

const grid = (text: string | null) => ({
  exportText: jest.fn(async (_options: unknown) => text),
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('exportCsv', () => {
  it('sends the tree as CSV with a byte order mark to the extension host', async () => {
    jest
      .spyOn(vscodeMessenger, 'getVsCodeAPI')
      .mockReturnValue({} as ReturnType<typeof vscodeMessenger.getVsCodeAPI>);
    const send = jest.spyOn(vscodeMessenger, 'send').mockImplementation(() => undefined);
    const source = grid('"Name"\n"a"');

    await exportCsv(source, 'soql.csv');

    expect(source.exportText).toHaveBeenCalledWith({ format: 'csv', tree: true });
    expect(send).toHaveBeenCalledWith('saveFile', {
      fileContent: `${BOM}"Name"\n"a"`,
      options: { defaultFileName: 'soql.csv' },
    });
  });

  it('downloads the file in the browser outside VS Code', async () => {
    jest.spyOn(vscodeMessenger, 'getVsCodeAPI').mockReturnValue(null);
    const createUrl = jest.fn((_blob: Blob) => 'blob:csv');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: jest.fn() });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await exportCsv(grid('"Name"'), 'dml.csv');

    expect(click).toHaveBeenCalledTimes(1);
    const blob = createUrl.mock.calls[0]?.[0];
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob as Blob);
    });
    expect([...bytes]).toEqual([...new TextEncoder().encode(`${BOM}"Name"`)]);
  });

  it('saves nothing when the grid has no rows yet', async () => {
    const send = jest.spyOn(vscodeMessenger, 'send').mockImplementation(() => undefined);

    await exportCsv(grid(null), 'dml.csv');

    expect(send).not.toHaveBeenCalled();
  });
});
