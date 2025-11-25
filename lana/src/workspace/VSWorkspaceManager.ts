/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { Uri, workspace } from 'vscode';
import type { ApexSymbol } from '../salesforce/codesymbol/ApexSymbolParser';
import type { SfdxProject } from '../salesforce/codesymbol/SfdxProject';
import { findSymbol } from '../salesforce/codesymbol/SymbolFinder';
import { VSWorkspace } from './VSWorkspace';

export class VSWorkspaceManager {
  workspaceFolders: VSWorkspace[] = [];

  constructor() {
    if (workspace.workspaceFolders) {
      this.workspaceFolders = workspace.workspaceFolders.map((folder) => {
        return new VSWorkspace(folder);
      });
    }
  }

  async findSymbol(apexSymbol: ApexSymbol): Promise<Uri | null> {
    return await findSymbol(this, apexSymbol);
  }

  getAllProjects(): SfdxProject[] {
    return this.workspaceFolders.flatMap((folder) => folder.getAllProjects());
  }

  getWorkspaceForNamespacedProjects(namespace: string): VSWorkspace[] {
    return this.workspaceFolders.filter(
      (folder) => folder.getProjectsForNamespace(namespace).length,
    );
  }

  async initialiseWorkspaceProjectInfo(forceRefresh = false) {
    await Promise.all(
      this.workspaceFolders
        .filter((folder) => forceRefresh || !folder.getAllProjects().length)
        .map((folder) => folder.parseSfdxProjects()),
    );
  }
}
