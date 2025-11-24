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
  const sfdxProjectUris = await workspace.findFiles(relativePattern, '**/node_modules/**');

  for (const uri of sfdxProjectUris) {
    try {
      const document = await workspace.openTextDocument(uri);
      const content = document.getText();
      projects.push(JSON.parse(content) as SfdxProject);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to parse sfdx-project.json at ${uri.fsPath}:`, error);
    }
  }

  return projects;
}
