/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, Uri, workspace, type WorkspaceFolder } from 'vscode';
import { SfdxProject } from './SfdxProject';

interface RawPackageDirectory {
  readonly path: string;
  readonly default?: boolean;
}

export interface RawSfdxProject {
  readonly name?: string | null;
  readonly namespace?: string;
  readonly packageDirectories?: readonly RawPackageDirectory[];
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

      if (!Array.isArray(rawProject.packageDirectories)) {
        throw new Error('packageDirectories is missing or not an array');
      }

      const projectDir = Uri.joinPath(uri, '..');
      const project: SfdxProject = new SfdxProject(
        rawProject.name ?? null,
        rawProject.namespace ?? '',
        rawProject.packageDirectories.map((pkg) => ({
          uri: Uri.joinPath(projectDir, pkg.path),
          default: pkg.default ?? false,
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
