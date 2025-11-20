import { Uri, workspace } from 'vscode';
import type { ApexSymbol } from '../salesforce/codesymbol/ApexSymbolParser';
import type { SfdxProject } from '../salesforce/codesymbol/SfdxProjectReader';
import { SymbolFinder } from '../salesforce/codesymbol/SymbolFinder';
import { VSWorkspace } from './VSWorkspace';

export class VSWorkspaceManager {
  symbolFinder = new SymbolFinder();
  workspaceFolders: VSWorkspace[] = [];

  constructor() {
    if (workspace.workspaceFolders) {
      this.workspaceFolders = workspace.workspaceFolders.map((folder) => {
        return new VSWorkspace(folder);
      });
    }
  }

  async findSymbol(apexSymbol: ApexSymbol): Promise<Uri[]> {
    await this.refreshWorkspaceProjectInfo();

    return await this.symbolFinder.findSymbol(this, apexSymbol);
  }

  getAllProjects(): SfdxProject[] {
    return this.workspaceFolders.flatMap((folder) => folder.getAllProjects());
  }

  getWorkspaceForNamespacedProjects(namespace: string): VSWorkspace[] {
    return this.workspaceFolders.filter(
      (folder) => folder.getProjectsForNamespace(namespace).length,
    );
  }

  getProjectsForNamespace(namespace: string): SfdxProject[] {
    return this.workspaceFolders.flatMap((folder) => folder.getProjectsForNamespace(namespace));
  }

  private async refreshWorkspaceProjectInfo() {
    await Promise.all(this.workspaceFolders.map((folder) => folder.parseSfdxProjects()));
  }
}
