/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Uri, type WorkspaceFolder } from 'vscode';
import type { ApexSymbol } from '../salesforce/codesymbol/ApexSymbolParser';
import type { SfdxProject } from '../salesforce/codesymbol/SfdxProject';
import { getProjects } from '../salesforce/codesymbol/SfdxProjectReader';

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

    await Promise.all(sfdxProjects.map((sfdxProject) => sfdxProject.buildClassIndex()));

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

  findClass(apexSymbol: ApexSymbol): Uri[] {
    const projects = apexSymbol.namespace
      ? this.getProjectsForNamespace(apexSymbol.namespace)
      : this.getAllProjects();

    return projects.flatMap((project) => project.findClass(apexSymbol.outerClass));
  }
}
