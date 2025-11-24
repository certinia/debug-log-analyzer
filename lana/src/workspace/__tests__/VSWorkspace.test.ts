/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, Uri, workspace, type WorkspaceFolder } from 'vscode';
import type { SfdxProject } from '../../salesforce/codesymbol/SfdxProjectReader';
import { VSWorkspace } from '../VSWorkspace';

jest.mock('vscode');
jest.mock('../../salesforce/codesymbol/SfdxProjectReader');

describe('VSWorkspace', () => {
  const mockWorkspaceFolder = {
    uri: { fsPath: '/workspace' },
    name: 'test-workspace',
    index: 0,
  } as WorkspaceFolder;

  let vsWorkspace: VSWorkspace;

  beforeEach(() => {
    jest.clearAllMocks();
    vsWorkspace = new VSWorkspace(mockWorkspaceFolder);
  });

  describe('path', () => {
    it('should return workspace folder path', () => {
      expect(vsWorkspace.path()).toBe('/workspace');
    });
  });

  describe('name', () => {
    it('should return workspace folder name', () => {
      expect(vsWorkspace.name()).toBe('test-workspace');
    });
  });

  describe('parseSfdxProjects', () => {
    it('should group projects by namespace', async () => {
      const { getProjects } = await import('../../salesforce/codesymbol/SfdxProjectReader');
      const mockProjects: SfdxProject[] = [
        { name: 'project1', namespace: 'ns1', packageDirectories: [] },
        { name: 'project2', namespace: 'ns1', packageDirectories: [] },
        { name: 'project3', namespace: 'ns2', packageDirectories: [] },
        { name: 'project4', namespace: '', packageDirectories: [] },
      ];

      (getProjects as jest.Mock).mockResolvedValue(mockProjects);

      await vsWorkspace.parseSfdxProjects();

      expect(vsWorkspace.getProjectsForNamespace('ns1')).toHaveLength(2);
      expect(vsWorkspace.getProjectsForNamespace('ns2')).toHaveLength(1);
      expect(vsWorkspace.getProjectsForNamespace('')).toHaveLength(1);
    });
  });

  describe('getProjectsForNamespace', () => {
    it('should return empty array for unknown namespace', () => {
      expect(vsWorkspace.getProjectsForNamespace('unknown')).toEqual([]);
    });

    it('should return projects matching the namespace', async () => {
      const { getProjects } = await import('../../salesforce/codesymbol/SfdxProjectReader');
      const ns1Projects: SfdxProject[] = [
        { name: 'project1', namespace: 'ns1', packageDirectories: [] },
        { name: 'project2', namespace: 'ns1', packageDirectories: [] },
      ];
      const mockProjects: SfdxProject[] = [
        ...ns1Projects,
        { name: 'project3', namespace: 'ns2', packageDirectories: [] },
      ];

      (getProjects as jest.Mock).mockResolvedValue(mockProjects);
      await vsWorkspace.parseSfdxProjects();

      expect(vsWorkspace.getProjectsForNamespace('ns1')).toEqual(ns1Projects);
    });
  });

  describe('getAllProjects', () => {
    it('should return all projects across namespaces', async () => {
      const { getProjects } = await import('../../salesforce/codesymbol/SfdxProjectReader');
      const mockProjects: SfdxProject[] = [
        { name: 'project1', namespace: 'ns1', packageDirectories: [] },
        { name: 'project2', namespace: 'ns2', packageDirectories: [] },
      ];

      (getProjects as jest.Mock).mockResolvedValue(mockProjects);

      await vsWorkspace.parseSfdxProjects();

      expect(vsWorkspace.getAllProjects()).toEqual(mockProjects);
    });
  });

  describe('findClass', () => {
    beforeEach(async () => {
      const { getProjects } = await import('../../salesforce/codesymbol/SfdxProjectReader');
      const mockProjects: SfdxProject[] = [
        {
          name: 'project1',
          namespace: 'ns1',
          packageDirectories: [{ path: 'force-app', default: true }],
        },
        {
          name: 'project2',
          namespace: '',
          packageDirectories: [{ path: 'src', default: true }],
        },
      ];

      (getProjects as jest.Mock).mockResolvedValue(mockProjects);
      await vsWorkspace.parseSfdxProjects();
    });

    it('should search in namespaced projects when namespace provided', async () => {
      const mockUri = { fsPath: '/workspace/force-app/classes/MyClass.cls' };
      (workspace.findFiles as jest.Mock).mockResolvedValue([mockUri]);
      (Uri.joinPath as jest.Mock).mockReturnValue({ fsPath: '/workspace/force-app' });

      const result = await vsWorkspace.findClass({
        fullSymbol: 'ns1.MyClass.method()',
        namespace: 'ns1',
        outerClass: 'MyClass',
        innerClass: null,
        method: 'method',
        parameters: '',
      });

      expect(result).toEqual([mockUri]);
      expect(RelativePattern).toHaveBeenCalledWith(
        { fsPath: '/workspace/force-app' },
        '**/MyClass.cls',
      );
    });

    it('should search in all projects when no namespace provided', async () => {
      (workspace.findFiles as jest.Mock).mockResolvedValue([]);
      (Uri.joinPath as jest.Mock).mockReturnValue({ fsPath: '/workspace/src' });

      await vsWorkspace.findClass({
        fullSymbol: 'MyClass.method()',
        namespace: null,
        outerClass: 'MyClass',
        innerClass: null,
        method: 'method',
        parameters: '',
      });

      expect(workspace.findFiles).toHaveBeenCalled();
    });
  });
});
