/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, workspace, type WorkspaceFolder } from 'vscode';

export interface SfdxProject {
  readonly name: string | null;
  readonly namespace: string;
  readonly packageDirectories: readonly PackageDirectory[];
}

export interface PackageDirectory {
  readonly path: string;
  readonly default: boolean;
}

export async function getProjects(workspaceFolder: WorkspaceFolder): Promise<SfdxProject[]> {
  const projects: SfdxProject[] = [];

  const relativePattern = new RelativePattern(workspaceFolder, '**/sfdx-project.json');
  // TODO: Check if any node modules use sfdx-project.json files
  const sfdxProjectUris = await workspace.findFiles(relativePattern, '**/node_modules/**');

  for (const uri of sfdxProjectUris) {
    try {
      const document = await workspace.openTextDocument(uri);
      const content = document.getText();
      projects.push(JSON.parse(content) as SfdxProject);
    } catch {
      // Skip invalid JSON files
    }
  }

  return projects;
}
