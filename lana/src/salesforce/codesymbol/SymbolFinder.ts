/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import type { Uri } from 'vscode';
import type { VSWorkspace } from '../../workspace/VSWorkspace.js';
import type { VSWorkspaceManager } from '../../workspace/VSWorkspaceManager.js';
import { type ApexSymbol } from './ApexSymbolParser.js';

export class SymbolFinder {
  async findSymbol(workspaceManager: VSWorkspaceManager, apexSymbol: ApexSymbol): Promise<Uri[]> {
    const matchingFolders = apexSymbol.namespace
      ? workspaceManager.getWorkspaceForNamespacedProjects(apexSymbol.namespace)
      : workspaceManager.workspaceFolders;

    // Quick-pick here to choose from valid projects???

    return await this.getClassFilepaths(matchingFolders, apexSymbol);
  }

  async getClassFilepaths(folders: VSWorkspace[], apexSymbol: ApexSymbol): Promise<Uri[]> {
    return (await Promise.all(folders.map((folder) => folder.findClass(apexSymbol)))).flat();
  }
}
