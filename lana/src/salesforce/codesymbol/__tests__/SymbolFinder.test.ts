/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { Uri, WorkspaceFolder } from 'vscode';
import { QuickPick } from '../../../display/QuickPick';
import { VSWorkspace } from '../../../workspace/VSWorkspace';
import { VSWorkspaceManager } from '../../../workspace/VSWorkspaceManager';
import type { ApexSymbol } from '../ApexSymbolParser';
import { findSymbol } from '../SymbolFinder';

jest.mock('vscode');
jest.mock('../../../display/QuickPick');
jest.mock('../../../workspace/VSWorkspace');
jest.mock('../../../workspace/VSWorkspaceManager');

function createSymbol(opts: { namespace?: string | null; outerClass: string }): ApexSymbol {
  return {
    fullSymbol: 'testSymbol',
    namespace: opts.namespace ?? null,
    outerClass: opts.outerClass,
    innerClass: null,
    method: 'method',
    parameters: '',
  };
}

function createMockUri(path: string): Uri {
  return { fsPath: path } as Uri;
}

function createMockWorkspace(findClassResult: Uri[]): VSWorkspace {
  const mockWorkspaceFolder = { uri: { fsPath: '/test' }, name: 'test' } as WorkspaceFolder;
  const workspace = new VSWorkspace(mockWorkspaceFolder);
  (workspace.findClass as jest.Mock).mockReturnValue(findClassResult);
  return workspace;
}

function createMockManager(
  workspaceFolders: VSWorkspace[],
  namespacedWorkspaces: VSWorkspace[] = [],
): VSWorkspaceManager {
  const manager = new VSWorkspaceManager();
  manager.workspaceFolders = workspaceFolders;
  (manager.getWorkspaceForNamespacedProjects as jest.Mock).mockReturnValue(namespacedWorkspaces);
  return manager;
}

describe('SymbolFinder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findSymbol', () => {
    it('should return null when no classes found', async () => {
      const mockWorkspace = createMockWorkspace([]);
      const manager = createMockManager([mockWorkspace]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      const result = await findSymbol(manager, symbol);

      expect(result).toBeNull();
    });

    it('should return single result without showing QuickPick', async () => {
      const mockUri = createMockUri('/workspace/MyClass.cls');
      const mockWorkspace = createMockWorkspace([mockUri]);
      const manager = createMockManager([mockWorkspace]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      const result = await findSymbol(manager, symbol);

      expect(result).toBe(mockUri);
      expect(QuickPick.pick).not.toHaveBeenCalled();
    });

    it('should show QuickPick when multiple results found', async () => {
      const mockUri1 = createMockUri('/workspace1/MyClass.cls');
      const mockUri2 = createMockUri('/workspace2/MyClass.cls');
      const mockWorkspace = createMockWorkspace([mockUri1, mockUri2]);
      const manager = createMockManager([mockWorkspace]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      (QuickPick.pick as jest.Mock).mockResolvedValue([{ uri: mockUri1 }]);

      const result = await findSymbol(manager, symbol);

      expect(result).toBe(mockUri1);
      expect(QuickPick.pick).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ uri: mockUri1 }),
          expect.objectContaining({ uri: mockUri2 }),
        ]),
        expect.any(Object),
      );
    });

    it('should return null when user cancels QuickPick', async () => {
      const mockUri1 = createMockUri('/workspace1/MyClass.cls');
      const mockUri2 = createMockUri('/workspace2/MyClass.cls');
      const mockWorkspace = createMockWorkspace([mockUri1, mockUri2]);
      const manager = createMockManager([mockWorkspace]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      (QuickPick.pick as jest.Mock).mockResolvedValue([]);

      const result = await findSymbol(manager, symbol);

      expect(result).toBeNull();
    });

    it('should use namespaced workspaces when symbol has namespace', async () => {
      const mockUri = createMockUri('/namespaced/MyClass.cls');
      const regularWorkspace = createMockWorkspace([]);
      const namespacedWorkspace = createMockWorkspace([mockUri]);
      const manager = createMockManager([regularWorkspace], [namespacedWorkspace]);
      const symbol = createSymbol({ namespace: 'ns', outerClass: 'MyClass' });

      const result = await findSymbol(manager, symbol);

      expect(result).toBe(mockUri);
      expect(manager.getWorkspaceForNamespacedProjects).toHaveBeenCalledWith('ns');
      expect(namespacedWorkspace.findClass).toHaveBeenCalledWith(symbol);
      expect(regularWorkspace.findClass).not.toHaveBeenCalled();
    });

    it('should use all workspaces when symbol has no namespace', async () => {
      const mockUri = createMockUri('/workspace1/MyClass.cls');
      const mockWorkspace1 = createMockWorkspace([mockUri]);
      const mockWorkspace2 = createMockWorkspace([]);
      const manager = createMockManager([mockWorkspace1, mockWorkspace2]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      const result = await findSymbol(manager, symbol);

      expect(result).toBe(mockUri);
      expect(manager.getWorkspaceForNamespacedProjects).not.toHaveBeenCalled();
      expect(mockWorkspace1.findClass).toHaveBeenCalledWith(symbol);
      expect(mockWorkspace2.findClass).toHaveBeenCalledWith(symbol);
    });
  });
});
