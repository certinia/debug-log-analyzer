/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { Uri } from 'vscode';
import { QuickPick } from '../../display/QuickPick';
import type { VSWorkspace } from '../../workspace/VSWorkspace';
import type { VSWorkspaceManager } from '../../workspace/VSWorkspaceManager';
import type { ApexSymbol } from '../codesymbol/ApexSymbolParser';
import { SymbolFinder } from '../codesymbol/SymbolFinder';

jest.mock('vscode');
jest.mock('../../display/QuickPick');

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
  return {
    findClass: jest.fn().mockResolvedValue(findClassResult),
  } as unknown as VSWorkspace;
}

function createMockManager(
  workspaceFolders: VSWorkspace[],
  namespacedWorkspaces: VSWorkspace[] = [],
): VSWorkspaceManager {
  return {
    workspaceFolders,
    getWorkspaceForNamespacedProjects: jest.fn().mockReturnValue(namespacedWorkspaces),
  } as unknown as VSWorkspaceManager;
}

describe('SymbolFinder', () => {
  let symbolFinder: SymbolFinder;

  beforeEach(() => {
    jest.clearAllMocks();
    symbolFinder = new SymbolFinder();
  });

  describe('findSymbol', () => {
    it('should return null when no classes found', async () => {
      const mockWorkspace = createMockWorkspace([]);
      const manager = createMockManager([mockWorkspace]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      const result = await symbolFinder.findSymbol(manager, symbol);

      expect(result).toBeNull();
    });

    it('should return single result without showing QuickPick', async () => {
      const mockUri = createMockUri('/workspace/MyClass.cls');
      const mockWorkspace = createMockWorkspace([mockUri]);
      const manager = createMockManager([mockWorkspace]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      const result = await symbolFinder.findSymbol(manager, symbol);

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

      const result = await symbolFinder.findSymbol(manager, symbol);

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

      const result = await symbolFinder.findSymbol(manager, symbol);

      expect(result).toBeNull();
    });

    it('should use namespaced workspaces when symbol has namespace', async () => {
      const mockUri = createMockUri('/namespaced/MyClass.cls');
      const regularWorkspace = createMockWorkspace([]);
      const namespacedWorkspace = createMockWorkspace([mockUri]);
      const manager = createMockManager([regularWorkspace], [namespacedWorkspace]);
      const symbol = createSymbol({ namespace: 'ns', outerClass: 'MyClass' });

      const result = await symbolFinder.findSymbol(manager, symbol);

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

      const result = await symbolFinder.findSymbol(manager, symbol);

      expect(result).toBe(mockUri);
      expect(manager.getWorkspaceForNamespacedProjects).not.toHaveBeenCalled();
      expect(mockWorkspace1.findClass).toHaveBeenCalledWith(symbol);
      expect(mockWorkspace2.findClass).toHaveBeenCalledWith(symbol);
    });
  });
});
