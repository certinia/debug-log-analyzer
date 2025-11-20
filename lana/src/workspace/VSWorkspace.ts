/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { RelativePattern, Uri, workspace, type WorkspaceFolder } from 'vscode';
import type { ApexSymbol } from '../salesforce/codesymbol/ApexSymbolParser';
import { getProjects, type SfdxProject } from '../salesforce/codesymbol/SfdxProjectReader';

export class VSWorkspace {
  workspaceFolder: WorkspaceFolder;
  sfdxProjectsByNamespace: Record<string, SfdxProject[]> = {};

  constructor(workspaceFolder: WorkspaceFolder) {
    this.workspaceFolder = workspaceFolder;
  }

  path(): string {
    return this.workspaceFolder.uri.fsPath;
  }
  name(): string {
    return this.workspaceFolder.name;
  }

  async parseSfdxProjects() {
    const sfdxProjects = await getProjects(this.workspaceFolder);

    this.sfdxProjectsByNamespace = sfdxProjects.reduce(
      (projectsByNamespace, project) => {
        const namespace = project.namespace ?? '';

        if (!projectsByNamespace[namespace]) {
          projectsByNamespace[namespace] = [];
        }

        projectsByNamespace[namespace].push(project);
        return projectsByNamespace;
      },
      {} as Record<string, SfdxProject[]>,
    );
  }

  getProjectsForNamespace(namespace: string): SfdxProject[] {
    return this.sfdxProjectsByNamespace[namespace] ?? [];
  }

  getAllProjects(): SfdxProject[] {
    return Object.values(this.sfdxProjectsByNamespace).flat();
  }

  async findClass(apexSymbol: ApexSymbol): Promise<Uri[]> {
    const projects = apexSymbol.namespace
      ? this.getProjectsForNamespace(apexSymbol.namespace)
      : this.getAllProjects();

    const classFileName = `${apexSymbol.outerClass}.cls`;
    const uris: Uri[] = [];

    for (const project of projects) {
      for (const packageDir of project.packageDirectories) {
        const searchPath = Uri.joinPath(this.workspaceFolder.uri, packageDir.path);
        const pattern = new RelativePattern(searchPath, `**/${classFileName}`);
        const foundFiles = await workspace.findFiles(pattern);
        uris.push(...foundFiles);
      }
    }

    return uris;
  }
}
