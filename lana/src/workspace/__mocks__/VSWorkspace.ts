/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { WorkspaceFolder } from 'vscode';
import type { SfdxProject } from '../../salesforce/codesymbol/SfdxProject';

export class VSWorkspace {
  workspaceFolder: WorkspaceFolder;
  sfdxProjectsByNamespace: Record<string, SfdxProject[]> = {};

  constructor(workspaceFolder: WorkspaceFolder) {
    this.workspaceFolder = workspaceFolder;
  }

  path = jest.fn();
  name = jest.fn();
  parseSfdxProjects = jest.fn();
  getProjectsForNamespace = jest.fn();
  getAllProjects = jest.fn();
  findClass = jest.fn();
}
