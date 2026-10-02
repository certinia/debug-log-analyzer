/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { type Mock, vi } from 'vitest';
import type { WorkspaceFolder } from 'vscode';
import type { SfdxProject } from '../../salesforce/codesymbol/SfdxProject';

export class VSWorkspace {
  workspaceFolder: WorkspaceFolder;
  sfdxProjectsByNamespace: Record<string, SfdxProject[]> = {};

  constructor(workspaceFolder: WorkspaceFolder) {
    this.workspaceFolder = workspaceFolder;
  }

  path: Mock = vi.fn();
  name: Mock = vi.fn();
  parseSfdxProjects: Mock = vi.fn();
  getProjectsForNamespace: Mock = vi.fn();
  getAllProjects: Mock = vi.fn();
  findClass: Mock = vi.fn();
}
