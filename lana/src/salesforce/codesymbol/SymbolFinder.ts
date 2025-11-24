/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import type { Uri } from 'vscode';
import { workspace } from 'vscode';
import { Item, Options, QuickPick } from '../../display/QuickPick.js';
import type { VSWorkspace } from '../../workspace/VSWorkspace.js';
import type { VSWorkspaceManager } from '../../workspace/VSWorkspaceManager.js';
import { type ApexSymbol } from './ApexSymbolParser.js';

class ClassItem extends Item {
  uri: Uri;

  constructor(uri: Uri, className: string) {
    super(className, workspace.asRelativePath(uri), '');
    this.uri = uri;
  }
}

export class SymbolFinder {
  async findSymbol(
    workspaceManager: VSWorkspaceManager,
    apexSymbol: ApexSymbol,
  ): Promise<Uri | null> {
    const matchingFolders = apexSymbol.namespace
      ? workspaceManager.getWorkspaceForNamespacedProjects(apexSymbol.namespace)
      : workspaceManager.workspaceFolders;

    const paths = await this.getClassFilepaths(matchingFolders, apexSymbol);

    if (!paths.length) {
      return null;
    }

    if (paths.length === 1) {
      return paths[0]!;
    }

    const selected = await QuickPick.pick(
      paths.map((uri) => new ClassItem(uri, apexSymbol.outerClass)),
      new Options('Select a class:'),
    );

    return selected.length ? selected[0]!.uri : null;
  }

  private async getClassFilepaths(folders: VSWorkspace[], apexSymbol: ApexSymbol): Promise<Uri[]> {
    return (await Promise.all(folders.map((folder) => folder.findClass(apexSymbol)))).flat();
  }
}
