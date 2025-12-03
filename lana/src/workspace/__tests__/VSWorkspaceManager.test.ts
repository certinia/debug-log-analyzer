/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { workspace } from 'vscode';
import { SfdxProject } from '../../salesforce/codesymbol/SfdxProject';
import { findSymbol } from '../../salesforce/codesymbol/SymbolFinder';
import { VSWorkspace } from '../VSWorkspace';
import { VSWorkspaceManager } from '../VSWorkspaceManager';

jest.mock('vscode');
jest.mock('../VSWorkspace');
jest.mock('../../salesforce/codesymbol/SfdxProject');
jest.mock('../../salesforce/codesymbol/SymbolFinder');

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

  describe('initialiseWorkspaceProjectInfo', () => {
    it('should call parseSfdxProjects on all workspaces', async () => {
      const mockWorkspace1 = {
        getAllProjects: jest.fn().mockReturnValue([]),
        parseSfdxProjects: jest.fn().mockResolvedValue(undefined),
      };
      const mockWorkspace2 = {
        getAllProjects: jest.fn().mockReturnValue([]),
        parseSfdxProjects: jest.fn().mockResolvedValue(undefined),
      };

      const manager = new VSWorkspaceManager();
      manager.workspaceFolders = [mockWorkspace1, mockWorkspace2] as unknown as VSWorkspace[];

      await manager.initialiseWorkspaceProjectInfo();

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
      (findSymbol as jest.Mock).mockResolvedValueOnce(mockUri);

      const manager = new VSWorkspaceManager();

      const result = await manager.findSymbol(mockSymbol);

      expect(findSymbol).toHaveBeenCalledWith(manager, mockSymbol);
      expect(result).toEqual(mockUri);
    });
  });
});
