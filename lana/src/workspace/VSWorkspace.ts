/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import type { Uri, WorkspaceFolder } from 'vscode';
import type { ApexSymbol } from '../salesforce/codesymbol/ApexSymbolParser.js';
import type { SfdxProject } from '../salesforce/codesymbol/SfdxProject.js';
import { getProjects } from '../salesforce/codesymbol/SfdxProjectReader.js';

export class VSWorkspace {
  workspaceFolder: WorkspaceFolder;
  sfdxProjectsByNamespace = new Map<string, SfdxProject[]>();

  constructor(workspaceFolder: WorkspaceFolder) {
    this.workspaceFolder = workspaceFolder;
  }

  /** URI string for desktop and virtual web workspaces. */
  get uri(): string {
    return this.workspaceFolder.uri.toString();
  }

  name(): string {
    return this.workspaceFolder.name;
  }

  async parseSfdxProjects(): Promise<void> {
    const sfdxProjects = await getProjects(this.workspaceFolder);

    await Promise.all(sfdxProjects.map((sfdxProject) => sfdxProject.buildClassIndex()));

    this.sfdxProjectsByNamespace = sfdxProjects.reduce((projectsByNamespace, project) => {
      const namespace = project.namespace ?? '';
      const projects = projectsByNamespace.get(namespace) ?? [];
      projects.push(project);
      return projectsByNamespace.set(namespace, projects);
    }, new Map<string, SfdxProject[]>());
  }

  getProjectsForNamespace(namespace: string): SfdxProject[] {
    return this.sfdxProjectsByNamespace.get(namespace) ?? [];
  }

  getAllProjects(): SfdxProject[] {
    return [...this.sfdxProjectsByNamespace.values()].flat();
  }

  findClass(apexSymbol: ApexSymbol): Uri[] {
    const projects = apexSymbol.namespace
      ? this.getProjectsForNamespace(apexSymbol.namespace)
      : this.getAllProjects();

    return projects.flatMap((project) => project.findClass(apexSymbol.outerClass));
  }
}
