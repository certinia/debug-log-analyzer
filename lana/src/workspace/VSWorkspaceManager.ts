/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import type { Uri } from 'vscode';
import { workspace } from 'vscode';
import type { ApexSymbol } from '../salesforce/codesymbol/ApexSymbolParser';
import type { SfdxProject } from '../salesforce/codesymbol/SfdxProject';
import { findSymbol } from '../salesforce/codesymbol/SymbolFinder';
import { VSWorkspace } from './VSWorkspace';

export class VSWorkspaceManager {
  workspaceFolders: VSWorkspace[] = [];

  private initPromise: Promise<void> | null = null;

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

  /**
   * Parse and index the sfdx projects once, sharing the in-flight promise with
   * concurrent callers. A rejected parse is forgotten so the next call retries.
   */
  initialiseWorkspaceProjectInfo(): Promise<void> {
    return this.initPromise ?? this.startParse();
  }

  /** Rebuild the project index, replacing any previous result. */
  refresh(): Promise<void> {
    return this.startParse();
  }

  private startParse(): Promise<void> {
    const parsePromise = Promise.all(
      this.workspaceFolders.map((folder) => folder.parseSfdxProjects()),
    ).then(() => undefined);

    parsePromise.catch(() => {
      if (this.initPromise === parsePromise) {
        this.initPromise = null;
      }
    });

    this.initPromise = parsePromise;
    return parsePromise;
  }
}
