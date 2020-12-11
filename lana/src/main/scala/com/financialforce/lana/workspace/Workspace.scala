/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.workspace

import com.financialforce.lana.Display
import com.financialforce.lana.runtime.vscode.WorkspaceFolder

class Workspace(workspaceFolder: WorkspaceFolder, display: Display) {
  val path: String = workspaceFolder.uri.fsPath
  val name: String = workspaceFolder.name
}

object Workspace {
  def apply(workspaceFolder: WorkspaceFolder, display: Display): Workspace = {
    new Workspace(workspaceFolder, display)
  }
}
