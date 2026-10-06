/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { type Mock, vi } from 'vitest';
import type { VSWorkspace } from '../VSWorkspace';

export class VSWorkspaceManager {
  workspaceFolders: VSWorkspace[] = [];

  findSymbol: Mock = vi.fn();
  getAllProjects: Mock = vi.fn();
  initialiseWorkspaceProjectInfo: Mock = vi.fn();
  refresh: Mock = vi.fn();
}
