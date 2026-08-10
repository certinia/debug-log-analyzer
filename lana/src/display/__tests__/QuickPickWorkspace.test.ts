/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Context } from '../../Context.js';
import type { VSWorkspace } from '../../workspace/VSWorkspace.js';
import { QuickPick } from '../QuickPick.js';
import { QuickPickWorkspace } from '../QuickPickWorkspace.js';

function workspace(name: string, uri: string): VSWorkspace {
  return {
    name: () => name,
    uri,
    path: jest.fn(() => {
      throw new Error('desktop path must not be read');
    }),
  } as unknown as VSWorkspace;
}

describe('QuickPickWorkspace.pickOrReturn', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('displays and matches multi-root workspaces by URI', async () => {
    const local = workspace('Local', 'file:///workspace/local');
    const virtual = workspace('Virtual', 'vscode-vfs://github/project/root');
    const pick = jest.spyOn(QuickPick, 'pick').mockImplementation(async (items) => {
      expect(items.map((item) => item.description)).toEqual([local.uri, virtual.uri]);
      return [items[1]!];
    });
    const context = {
      workspaceManager: { workspaceFolders: [local, virtual] },
    } as unknown as Context;

    await expect(QuickPickWorkspace.pickOrReturn(context)).resolves.toBe(virtual);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(local.path).not.toHaveBeenCalled();
    expect(virtual.path).not.toHaveBeenCalled();
  });
});
