/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import type { WorkspaceFolder } from 'vscode';

export class VSWorkspace {
  workspaceFolder: WorkspaceFolder;

  constructor(workspaceFolder: WorkspaceFolder) {
    this.workspaceFolder = workspaceFolder;
  }

  /** URI string (works on desktop file:// and web vscode-vfs://memfs:// schemes). */
  get uri(): string {
    return this.workspaceFolder.uri.toString();
  }

  /** @deprecated Use `uri` for web-safe code. Desktop-only fsPath. */
  path(): string {
    return this.workspaceFolder.uri.fsPath;
  }

  name(): string {
    return this.workspaceFolder.name;
  }
}
