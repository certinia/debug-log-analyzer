/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { WorkspaceFolder } from "vscode";

export class VSWorkspace {
  workspaceFolder: WorkspaceFolder;

  constructor(workspaceFolder: WorkspaceFolder) {
    this.workspaceFolder = workspaceFolder;
  }

  path(): string {
    return this.workspaceFolder.uri.fsPath;
  }
  name(): string {
    return this.workspaceFolder.name;
  }
}
