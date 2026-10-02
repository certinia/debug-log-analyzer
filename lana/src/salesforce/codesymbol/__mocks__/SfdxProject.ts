/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { type Mock, vi } from 'vitest';
import type { PackageDirectory } from '../SfdxProject';

export class SfdxProject {
  readonly name: string | null;
  readonly namespace: string;
  readonly packageDirectories: readonly PackageDirectory[];

  constructor(
    name: string | null,
    namespace: string,
    packageDirectories: readonly PackageDirectory[],
  ) {
    this.name = name;
    this.namespace = namespace;
    this.packageDirectories = packageDirectories;
  }

  findClass: Mock = vi.fn();
  buildClassIndex: Mock = vi.fn();
}
