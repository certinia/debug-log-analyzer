import path from 'path';
import { RelativePattern, Uri, workspace } from 'vscode';

export interface PackageDirectory {
  readonly path: string;
  readonly default: boolean;
}

export class SfdxProject {
  readonly name: string | null;
  readonly namespace: string;
  readonly packageDirectories: readonly PackageDirectory[];

  private classCache?: Map<string, string[]>;

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
    const paths = this.classCache?.get(className) ?? [];
    return paths.map((p) => Uri.file(p));
  }

  async buildClassIndex(): Promise<void> {
    this.classCache = new Map();

    const allUris = (
      await Promise.all(
        this.packageDirectories.map((packageDir) => this.findClassesInProject(packageDir.path)),
      )
    ).flat();

    for (const uri of allUris) {
      const className = path.basename(uri.fsPath, '.cls');
      if (!this.classCache.has(className)) {
        this.classCache.set(className, []);
      }
      this.classCache.get(className)!.push(uri.fsPath);
    }
  }

  private async findClassesInProject(basePath: string): Promise<Uri[]> {
    const pattern = new RelativePattern(basePath, '**/*.cls');
    return await workspace.findFiles(pattern);
  }
}
