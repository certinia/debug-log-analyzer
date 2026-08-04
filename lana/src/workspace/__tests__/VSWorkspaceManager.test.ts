/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { workspace } from 'vscode';
import { SfdxProject } from '../../salesforce/codesymbol/SfdxProject';
import { findSymbol } from '../../salesforce/codesymbol/SymbolFinder';
import type { VSWorkspace } from '../VSWorkspace';
import { VSWorkspaceManager } from '../VSWorkspaceManager';

jest.mock('vscode');
jest.mock('../VSWorkspace');
jest.mock('../../salesforce/codesymbol/SfdxProject');
jest.mock('../../salesforce/codesymbol/SymbolFinder');

function createMockWorkspace() {
  return {
    parseSfdxProjects: jest.fn().mockResolvedValue(undefined),
    getAllProjects: jest.fn().mockReturnValue([]),
  };
}

function createManager(...folders: object[]): VSWorkspaceManager {
  const manager = new VSWorkspaceManager();
  manager.workspaceFolders = folders as unknown as VSWorkspace[];
  return manager;
}

describe('VSWorkspaceManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (workspace as { workspaceFolders?: unknown[] }).workspaceFolders = undefined;
  });

  describe('constructor', () => {
    it('should create VSWorkspace for each workspace folder', () => {
      const mockFolders = [
        { uri: { fsPath: '/ws1' }, name: 'ws1', index: 0 },
        { uri: { fsPath: '/ws2' }, name: 'ws2', index: 1 },
      ];
      (workspace as { workspaceFolders?: unknown[] }).workspaceFolders = mockFolders;

      const manager = new VSWorkspaceManager();

      expect(manager.workspaceFolders).toHaveLength(2);
    });

    it('should handle no workspace folders', () => {
      const manager = new VSWorkspaceManager();

      expect(manager.workspaceFolders).toHaveLength(0);
    });
  });

  describe('getAllProjects', () => {
    it('should aggregate projects from all workspaces', () => {
      const mockProjects1 = [new SfdxProject('p1', 'ns1', [])];
      const mockProjects2 = [new SfdxProject('p2', 'ns2', [])];

      const mockWorkspace1 = createMockWorkspace();
      const mockWorkspace2 = createMockWorkspace();
      mockWorkspace1.getAllProjects.mockReturnValue(mockProjects1);
      mockWorkspace2.getAllProjects.mockReturnValue(mockProjects2);

      const manager = createManager(mockWorkspace1, mockWorkspace2);

      const result = manager.getAllProjects();

      expect(result).toEqual([...mockProjects1, ...mockProjects2]);
    });
  });

  describe('initialiseWorkspaceProjectInfo', () => {
    it('should call parseSfdxProjects on all workspaces', async () => {
      const mockWorkspace1 = createMockWorkspace();
      const mockWorkspace2 = createMockWorkspace();

      const manager = createManager(mockWorkspace1, mockWorkspace2);

      await manager.initialiseWorkspaceProjectInfo();

      expect(mockWorkspace1.parseSfdxProjects).toHaveBeenCalled();
      expect(mockWorkspace2.parseSfdxProjects).toHaveBeenCalled();
    });

    it('should share one parse across concurrent and repeat calls', async () => {
      const mockWorkspace = createMockWorkspace();
      const manager = createManager(mockWorkspace);

      await Promise.all([
        manager.initialiseWorkspaceProjectInfo(),
        manager.initialiseWorkspaceProjectInfo(),
      ]);
      await manager.initialiseWorkspaceProjectInfo();

      expect(mockWorkspace.parseSfdxProjects).toHaveBeenCalledTimes(1);
    });

    it('should retry after a rejected parse', async () => {
      const mockWorkspace = createMockWorkspace();
      mockWorkspace.parseSfdxProjects.mockRejectedValueOnce(new Error('parse failed'));

      const manager = createManager(mockWorkspace);

      await expect(manager.initialiseWorkspaceProjectInfo()).rejects.toThrow('parse failed');
      await manager.initialiseWorkspaceProjectInfo();

      expect(mockWorkspace.parseSfdxProjects).toHaveBeenCalledTimes(2);
    });
  });

  describe('refresh', () => {
    it('should re-parse even when already initialised', async () => {
      const mockWorkspace = createMockWorkspace();
      const manager = createManager(mockWorkspace);

      await manager.initialiseWorkspaceProjectInfo();
      await manager.refresh();
      await manager.initialiseWorkspaceProjectInfo();

      expect(mockWorkspace.parseSfdxProjects).toHaveBeenCalledTimes(2);
    });
  });

  describe('findSymbol', () => {
    const mockUri = { fsPath: '/test/MyClass.cls' };

    function createManagerWithWorkspace() {
      const mockWorkspace = createMockWorkspace();
      return { manager: createManager(mockWorkspace), mockWorkspace };
    }

    it('should parse the symbol into candidates and delegate to the finder', async () => {
      const { manager } = createManagerWithWorkspace();
      (findSymbol as jest.Mock).mockResolvedValue({ status: 'found', uri: mockUri });

      const result = await manager.findSymbol('MyClass.method()');

      expect(findSymbol).toHaveBeenCalledWith(manager.workspaceFolders, [
        { fullSymbol: 'MyClass.method()', namespace: null, outerClass: 'MyClass' },
        { fullSymbol: 'MyClass.method()', namespace: null, outerClass: 'method' },
      ]);
      expect(result).toEqual({ status: 'found', uri: mockUri });
    });

    it('should report not-found without searching when the symbol yields no candidates', async () => {
      const { manager } = createManagerWithWorkspace();

      const result = await manager.findSymbol('()');

      expect(result).toEqual({ status: 'not-found' });
      expect(findSymbol).not.toHaveBeenCalled();
    });

    it('should rebuild a pre-existing index once and retry when all candidates miss', async () => {
      const { manager, mockWorkspace } = createManagerWithWorkspace();
      await manager.initialiseWorkspaceProjectInfo();
      (findSymbol as jest.Mock)
        .mockResolvedValueOnce({ status: 'not-found' })
        .mockResolvedValueOnce({ status: 'found', uri: mockUri });

      const result = await manager.findSymbol('MyClass.method()');

      expect(result).toEqual({ status: 'found', uri: mockUri });
      expect(mockWorkspace.parseSfdxProjects).toHaveBeenCalledTimes(2);
      expect(findSymbol).toHaveBeenCalledTimes(2);
    });

    it('should not retry when the index was built by this call', async () => {
      const { manager, mockWorkspace } = createManagerWithWorkspace();
      (findSymbol as jest.Mock).mockResolvedValue({ status: 'not-found' });

      const result = await manager.findSymbol('MyClass.method()');

      expect(result).toEqual({ status: 'not-found' });
      expect(mockWorkspace.parseSfdxProjects).toHaveBeenCalledTimes(1);
      expect(findSymbol).toHaveBeenCalledTimes(1);
    });

    it('should not retry when the user cancelled the picker', async () => {
      const { manager, mockWorkspace } = createManagerWithWorkspace();
      await manager.initialiseWorkspaceProjectInfo();
      (findSymbol as jest.Mock).mockResolvedValue({ status: 'cancelled' });

      const result = await manager.findSymbol('MyClass.method()');

      expect(result).toEqual({ status: 'cancelled' });
      expect(mockWorkspace.parseSfdxProjects).toHaveBeenCalledTimes(1);
      expect(findSymbol).toHaveBeenCalledTimes(1);
    });
  });
});
