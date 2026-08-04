/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { Uri, WorkspaceFolder } from 'vscode';
import { QuickPick } from '../../../display/QuickPick';
import { VSWorkspace } from '../../../workspace/VSWorkspace';
import type { ApexSymbol } from '../ApexSymbolParser';
import { findSymbol } from '../SymbolFinder';

jest.mock('vscode');
jest.mock('../../../display/QuickPick');
jest.mock('../../../workspace/VSWorkspace');

function createSymbol(opts: { namespace?: string | null; outerClass: string }): ApexSymbol {
  return {
    fullSymbol: 'testSymbol',
    namespace: opts.namespace ?? null,
    outerClass: opts.outerClass,
  };
}

function createMockUri(path: string): Uri {
  return { fsPath: path, toString: () => path } as unknown as Uri;
}

function createMockWorkspace(findClassResult: Uri[]): VSWorkspace {
  const mockWorkspaceFolder = { uri: { fsPath: '/test' }, name: 'test' } as WorkspaceFolder;
  const workspace = new VSWorkspace(mockWorkspaceFolder);
  (workspace.findClass as jest.Mock).mockReturnValue(findClassResult);
  return workspace;
}

describe('SymbolFinder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findSymbol', () => {
    it('should report not-found when no classes match', async () => {
      const mockWorkspace = createMockWorkspace([]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      const result = await findSymbol([mockWorkspace], [symbol]);

      expect(result).toEqual({ status: 'not-found' });
    });

    it('should report not-found for an empty candidate list', async () => {
      const result = await findSymbol([createMockWorkspace([])], []);

      expect(result).toEqual({ status: 'not-found' });
    });

    it('should return a single result without showing QuickPick', async () => {
      const mockUri = createMockUri('/workspace/MyClass.cls');
      const mockWorkspace = createMockWorkspace([mockUri]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      const result = await findSymbol([mockWorkspace], [symbol]);

      expect(result).toEqual({ status: 'found', uri: mockUri });
      expect(QuickPick.pick).not.toHaveBeenCalled();
    });

    it('should show QuickPick when multiple results found', async () => {
      const mockUri1 = createMockUri('/workspace1/MyClass.cls');
      const mockUri2 = createMockUri('/workspace2/MyClass.cls');
      const mockWorkspace = createMockWorkspace([mockUri1, mockUri2]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      (QuickPick.pick as jest.Mock).mockResolvedValue([{ uri: mockUri1 }]);

      const result = await findSymbol([mockWorkspace], [symbol]);

      expect(result).toEqual({ status: 'found', uri: mockUri1 });
      expect(QuickPick.pick).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ uri: mockUri1 }),
          expect.objectContaining({ uri: mockUri2 }),
        ]),
        expect.any(Object),
      );
    });

    it('should de-duplicate the same file indexed by overlapping package directories', async () => {
      const mockUri1 = createMockUri('/workspace/MyClass.cls');
      const mockUri2 = createMockUri('/workspace/MyClass.cls');
      const mockWorkspace = createMockWorkspace([mockUri1, mockUri2]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      const result = await findSymbol([mockWorkspace], [symbol]);

      expect(result).toEqual({ status: 'found', uri: mockUri1 });
      expect(QuickPick.pick).not.toHaveBeenCalled();
    });

    it('should report cancelled when the user dismisses the QuickPick', async () => {
      const mockUri1 = createMockUri('/workspace1/MyClass.cls');
      const mockUri2 = createMockUri('/workspace2/MyClass.cls');
      const mockWorkspace = createMockWorkspace([mockUri1, mockUri2]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      (QuickPick.pick as jest.Mock).mockResolvedValue([]);

      const result = await findSymbol([mockWorkspace], [symbol]);

      expect(result).toEqual({ status: 'cancelled' });
    });

    it('should fall back to the next candidate when the first has no matches', async () => {
      const mockUri = createMockUri('/workspace/MyClass.cls');
      const mockWorkspace = createMockWorkspace([]);
      const first = createSymbol({ namespace: 'ns', outerClass: 'MyClass' });
      const second = createSymbol({ outerClass: 'MyClass' });

      (mockWorkspace.findClass as jest.Mock).mockReturnValueOnce([]).mockReturnValue([mockUri]);

      const result = await findSymbol([mockWorkspace], [first, second]);

      expect(result).toEqual({ status: 'found', uri: mockUri });
      expect(mockWorkspace.findClass).toHaveBeenNthCalledWith(1, first);
      expect(mockWorkspace.findClass).toHaveBeenNthCalledWith(2, second);
    });

    it('should not consult later candidates once one matches', async () => {
      const mockUri = createMockUri('/workspace/MyClass.cls');
      const mockWorkspace = createMockWorkspace([mockUri]);
      const first = createSymbol({ outerClass: 'MyClass' });
      const second = createSymbol({ outerClass: 'Other' });

      const result = await findSymbol([mockWorkspace], [first, second]);

      expect(result).toEqual({ status: 'found', uri: mockUri });
      expect(mockWorkspace.findClass).toHaveBeenCalledTimes(1);
      expect(mockWorkspace.findClass).toHaveBeenCalledWith(first);
    });

    it('should search every folder and let findClass apply the namespace filter', async () => {
      const mockUri = createMockUri('/namespaced/MyClass.cls');
      const folderWithoutNamespace = createMockWorkspace([]);
      const folderWithNamespace = createMockWorkspace([mockUri]);
      const symbol = createSymbol({ namespace: 'ns', outerClass: 'MyClass' });

      const result = await findSymbol([folderWithoutNamespace, folderWithNamespace], [symbol]);

      expect(result).toEqual({ status: 'found', uri: mockUri });
      expect(folderWithoutNamespace.findClass).toHaveBeenCalledWith(symbol);
      expect(folderWithNamespace.findClass).toHaveBeenCalledWith(symbol);
    });

    it('should collect matches from every folder for a candidate without a namespace', async () => {
      const mockUri = createMockUri('/workspace1/MyClass.cls');
      const mockWorkspace1 = createMockWorkspace([mockUri]);
      const mockWorkspace2 = createMockWorkspace([]);
      const symbol = createSymbol({ outerClass: 'MyClass' });

      const result = await findSymbol([mockWorkspace1, mockWorkspace2], [symbol]);

      expect(result).toEqual({ status: 'found', uri: mockUri });
      expect(mockWorkspace1.findClass).toHaveBeenCalledWith(symbol);
      expect(mockWorkspace2.findClass).toHaveBeenCalledWith(symbol);
    });
  });
});
