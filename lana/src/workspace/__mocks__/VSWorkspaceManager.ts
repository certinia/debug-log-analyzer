/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { VSWorkspace } from '../VSWorkspace';

export class VSWorkspaceManager {
  workspaceFolders: VSWorkspace[] = [];

  findSymbol = jest.fn();
  getAllProjects = jest.fn();
  getWorkspaceForNamespacedProjects = jest.fn();
  initialiseWorkspaceProjectInfo = jest.fn();
}
