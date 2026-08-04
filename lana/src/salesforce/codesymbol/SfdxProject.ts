/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import path from 'path';
import { RelativePattern, type Uri, workspace } from 'vscode';

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
    return this.classCache?.get(className) ?? [];
  }

  async buildClassIndex(): Promise<void> {
    this.classCache = new Map();

    const allUris = (
      await Promise.all(
        this.packageDirectories.map((packageDir) => this.findClassesInPackage(packageDir.uri)),
      )
    ).flat();

    for (const uri of allUris) {
      // uri.path is always '/'-separated (unlike fsPath), so posix basename is safe everywhere
      const className = path.posix.basename(uri.path, '.cls');
      if (!this.classCache.has(className)) {
        this.classCache.set(className, []);
      }
      this.classCache.get(className)!.push(uri);
    }
  }

  private async findClassesInPackage(packageUri: Uri): Promise<Uri[]> {
    const pattern = new RelativePattern(packageUri, '**/*.cls');
    return await workspace.findFiles(pattern);
  }
}
