/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, Uri, workspace, type WorkspaceFolder } from 'vscode';
import { type PackageDirectory, SfdxProject } from './SfdxProject';

export interface RawSfdxProject {
  readonly name: string | null;
  readonly namespace: string;
  readonly packageDirectories: readonly PackageDirectory[];
}

export async function getProjects(workspaceFolder: WorkspaceFolder): Promise<SfdxProject[]> {
  const projects: SfdxProject[] = [];

  const relativePattern = new RelativePattern(workspaceFolder, '**/sfdx-project.json');
  const sfdxProjectUris = await workspace.findFiles(relativePattern, '**/node_modules/**');

  for (const uri of sfdxProjectUris) {
    try {
      const document = await workspace.openTextDocument(uri);
      const content = document.getText();
      const rawProject = JSON.parse(content) as RawSfdxProject;

      const project: SfdxProject = new SfdxProject(
        rawProject.name,
        rawProject.namespace,
        rawProject.packageDirectories.map((pkg) => ({
          ...pkg,
          path: Uri.joinPath(uri, pkg.path).path.replace(/\/sfdx-project.json/i, ''),
        })),
      );

      projects.push(project);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to parse sfdx-project.json at ${uri.fsPath}:`, error);
    }
  }

  return projects;
}
