/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { Uri, WorkspaceFolder } from 'vscode';
import { SfdxProject } from '../../salesforce/codesymbol/SfdxProject';
import { getProjects } from '../../salesforce/codesymbol/SfdxProjectReader';
import { VSWorkspace } from '../VSWorkspace';

jest.mock('vscode');
jest.mock('../../salesforce/codesymbol/SfdxProjectReader');
jest.mock('../../salesforce/codesymbol/SfdxProject');

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

  describe('uri', () => {
    it('should expose the workspace folder URI', () => {
      expect(vsWorkspace.workspaceFolder.uri.fsPath).toBe('/workspace');
    });
  });

  describe('name', () => {
    it('should return workspace folder name', () => {
      expect(vsWorkspace.name()).toBe('test-workspace');
    });
  });

  describe('parseSfdxProjects', () => {
    it('should group projects by namespace', async () => {
      const mockProjects = [
        new SfdxProject('project1', 'ns1', []),
        new SfdxProject('project2', 'ns1', []),
        new SfdxProject('project3', 'ns2', []),
        new SfdxProject('project4', '', []),
      ];

      (getProjects as jest.Mock).mockResolvedValue(mockProjects);

      await vsWorkspace.parseSfdxProjects();

      expect(vsWorkspace.getProjectsForNamespace('ns1')).toHaveLength(2);
      expect(vsWorkspace.getProjectsForNamespace('ns2')).toHaveLength(1);
      expect(vsWorkspace.getProjectsForNamespace('')).toHaveLength(1);
      expect(mockProjects[0]!.buildClassIndex).toHaveBeenCalled();
    });

    it('should group a project with a null namespace under the default namespace', async () => {
      const mockProjects = [new SfdxProject('project1', null as unknown as string, [])];

      (getProjects as jest.Mock).mockResolvedValue(mockProjects);

      await vsWorkspace.parseSfdxProjects();

      expect(vsWorkspace.getProjectsForNamespace('')).toHaveLength(1);
    });
  });

  describe('getProjectsForNamespace', () => {
    it('should return empty array for unknown namespace', () => {
      expect(vsWorkspace.getProjectsForNamespace('unknown')).toEqual([]);
    });

    it('should not match Object.prototype members as namespaces', () => {
      expect(vsWorkspace.getProjectsForNamespace('constructor')).toEqual([]);
      expect(vsWorkspace.getProjectsForNamespace('toString')).toEqual([]);
    });

    it('should return projects matching the namespace', async () => {
      const ns1Projects = [
        new SfdxProject('project1', 'ns1', []),
        new SfdxProject('project2', 'ns1', []),
      ];
      const mockProjects = [...ns1Projects, new SfdxProject('project3', 'ns2', [])];

      (getProjects as jest.Mock).mockResolvedValue(mockProjects);
      await vsWorkspace.parseSfdxProjects();

      expect(vsWorkspace.getProjectsForNamespace('ns1')).toEqual(ns1Projects);
    });
  });

  describe('getAllProjects', () => {
    it('should return all projects across namespaces', async () => {
      const mockProjects = [
        new SfdxProject('project1', 'ns1', []),
        new SfdxProject('project2', 'ns2', []),
      ];

      (getProjects as jest.Mock).mockResolvedValue(mockProjects);

      await vsWorkspace.parseSfdxProjects();

      expect(vsWorkspace.getAllProjects()).toEqual(mockProjects);
    });
  });

  describe('findClass', () => {
    let mockProject1: SfdxProject;
    let mockProject2: SfdxProject;

    beforeEach(async () => {
      mockProject1 = new SfdxProject('project1', 'ns1', [
        { uri: { path: '/workspace/force-app' } as Uri, default: true },
      ]);
      mockProject2 = new SfdxProject('project2', '', [
        { uri: { path: '/workspace/src' } as Uri, default: true },
      ]);

      (getProjects as jest.Mock).mockResolvedValue([mockProject1, mockProject2]);
      await vsWorkspace.parseSfdxProjects();
    });

    it('should search in namespaced projects when namespace provided', () => {
      const mockUri = { fsPath: '/workspace/force-app/classes/MyClass.cls' } as Uri;
      (mockProject1.findClass as jest.Mock).mockReturnValue([mockUri]);

      const result = vsWorkspace.findClass({
        fullSymbol: 'ns1.MyClass.method()',
        namespace: 'ns1',
        outerClass: 'MyClass',
      });

      expect(result).toEqual([mockUri]);
      expect(mockProject1.findClass).toHaveBeenCalledWith('MyClass');
      expect(mockProject2.findClass).not.toHaveBeenCalled();
    });

    it('should search in all projects when no namespace provided', () => {
      const mockUri1 = { fsPath: '/workspace/force-app/classes/MyClass.cls' } as Uri;
      const mockUri2 = { fsPath: '/workspace/src/classes/MyClass.cls' } as Uri;
      (mockProject1.findClass as jest.Mock).mockReturnValue([mockUri1]);
      (mockProject2.findClass as jest.Mock).mockReturnValue([mockUri2]);

      const result = vsWorkspace.findClass({
        fullSymbol: 'MyClass.method()',
        namespace: null,
        outerClass: 'MyClass',
      });

      expect(result).toEqual([mockUri1, mockUri2]);
      expect(mockProject1.findClass).toHaveBeenCalledWith('MyClass');
      expect(mockProject2.findClass).toHaveBeenCalledWith('MyClass');
    });
  });
});
