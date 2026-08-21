/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { RelativePattern, type Uri, workspace } from 'vscode';
import { Utils } from 'vscode-uri';

export interface PackageDirectory {
  readonly uri: Uri;
  readonly default: boolean;
}

export class SfdxProject {
  readonly name: string | null;
  readonly namespace: string;
  readonly packageDirectories: readonly PackageDirectory[];

  private classCache?: Map<string, Uri[]>;

  constructor(
    name: string | null,
    namespace: string,
    packageDirectories: readonly PackageDirectory[],
  ) {
    this.name = name;
    this.namespace = namespace;
    this.packageDirectories = packageDirectories;
  }

  findClass(className: string): Uri[] {
    // Apex names are case-insensitive, so the index is keyed lowercase.
    return this.classCache?.get(className.toLowerCase()) ?? [];
  }

  async buildClassIndex(): Promise<void> {
    const allUris = (
      await Promise.all(
        this.packageDirectories.map((packageDir) =>
          workspace.findFiles(new RelativePattern(packageDir.uri, '**/*.cls')),
        ),
      )
    ).flat();

    // Build into a local map and only replace the cache once every search has
    // resolved, so a rejected findFiles never leaves an empty-but-valid cache.
    const classIndex = new Map<string, Uri[]>();
    for (const uri of allUris) {
      // uri.path is always '/'-separated (unlike fsPath), so posix basename is safe everywhere
      const className = Utils.basename(uri)
        .replace(/\.cls$/i, '')
        .toLowerCase();
      const uris = classIndex.get(className);
      if (uris) {
        uris.push(uri);
      } else {
        classIndex.set(className, [uri]);
      }
    }
    this.classCache = classIndex;
  }
}
