/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { workspace } from 'vscode';
import type { SfdxProject } from '../../salesforce/codesymbol/SfdxProjectReader';
import { VSWorkspace } from '../VSWorkspace';
import { VSWorkspaceManager } from '../VSWorkspaceManager';

jest.mock('vscode');
jest.mock('../VSWorkspace');

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
      expect(VSWorkspace).toHaveBeenCalledTimes(2);
    });

    it('should handle no workspace folders', () => {
      const manager = new VSWorkspaceManager();

      expect(manager.workspaceFolders).toHaveLength(0);
    });
  });

  describe('getAllProjects', () => {
    it('should aggregate projects from all workspaces', () => {
      const mockProjects1: SfdxProject[] = [
        { name: 'p1', namespace: 'ns1', packageDirectories: [] },
      ];
      const mockProjects2: SfdxProject[] = [
        { name: 'p2', namespace: 'ns2', packageDirectories: [] },
      ];

      const mockWorkspace1 = { getAllProjects: jest.fn().mockReturnValue(mockProjects1) };
      const mockWorkspace2 = { getAllProjects: jest.fn().mockReturnValue(mockProjects2) };

      const manager = new VSWorkspaceManager();
      manager.workspaceFolders = [mockWorkspace1, mockWorkspace2] as unknown as VSWorkspace[];

      const result = manager.getAllProjects();

      expect(result).toEqual([...mockProjects1, ...mockProjects2]);
    });
  });

  describe('getWorkspaceForNamespacedProjects', () => {
    it('should return workspaces that have projects with matching namespace', () => {
      const mockWorkspace1 = {
        getProjectsForNamespace: jest.fn().mockReturnValue([{ name: 'p1' }]),
      };
      const mockWorkspace2 = {
        getProjectsForNamespace: jest.fn().mockReturnValue([]),
      };

      const manager = new VSWorkspaceManager();
      manager.workspaceFolders = [mockWorkspace1, mockWorkspace2] as unknown as VSWorkspace[];

      const result = manager.getWorkspaceForNamespacedProjects('ns1');

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mockWorkspace1);
    });
  });

  describe('getProjectsForNamespace', () => {
    it('should aggregate namespaced projects from all workspaces', () => {
      const mockProjects1 = [{ name: 'p1', namespace: 'ns1' }];
      const mockProjects2 = [{ name: 'p2', namespace: 'ns1' }];

      const mockWorkspace1 = {
        getProjectsForNamespace: jest.fn().mockReturnValue(mockProjects1),
      };
      const mockWorkspace2 = {
        getProjectsForNamespace: jest.fn().mockReturnValue(mockProjects2),
      };

      const manager = new VSWorkspaceManager();
      manager.workspaceFolders = [mockWorkspace1, mockWorkspace2] as unknown as VSWorkspace[];

      const result = manager.getProjectsForNamespace('ns1');

      expect(result).toEqual([...mockProjects1, ...mockProjects2]);
    });
  });

  describe('refreshWorkspaceProjectInfo', () => {
    it('should call parseSfdxProjects on all workspaces', async () => {
      const mockWorkspace1 = { parseSfdxProjects: jest.fn().mockResolvedValue(undefined) };
      const mockWorkspace2 = { parseSfdxProjects: jest.fn().mockResolvedValue(undefined) };

      const manager = new VSWorkspaceManager();
      manager.workspaceFolders = [mockWorkspace1, mockWorkspace2] as unknown as VSWorkspace[];

      await manager.refreshWorkspaceProjectInfo();

      expect(mockWorkspace1.parseSfdxProjects).toHaveBeenCalled();
      expect(mockWorkspace2.parseSfdxProjects).toHaveBeenCalled();
    });
  });

  describe('findSymbol', () => {
    it('should delegate to symbolFinder', async () => {
      const mockUri = { fsPath: '/test/MyClass.cls' };
      const mockSymbol = {
        fullSymbol: 'MyClass.method()',
        namespace: null,
        outerClass: 'MyClass',
        innerClass: null,
        method: 'method',
        parameters: '',
      };

      const manager = new VSWorkspaceManager();
      manager.symbolFinder.findSymbol = jest.fn().mockResolvedValue(mockUri);

      const result = await manager.findSymbol(mockSymbol);

      expect(result).toEqual(mockUri);
      expect(manager.symbolFinder.findSymbol).toHaveBeenCalledWith(manager, mockSymbol);
    });
  });
});
