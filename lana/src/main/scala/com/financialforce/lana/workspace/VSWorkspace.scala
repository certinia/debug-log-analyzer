/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.workspace

import com.financialforce.lana.Display
import com.financialforce.lana.runtime.vscode.WorkspaceFolder

class VSWorkspace(workspaceFolder: WorkspaceFolder, display: Display) {
  val path: String = workspaceFolder.uri.fsPath
  val name: String = workspaceFolder.name
}

object VSWorkspace {
  def apply(workspaceFolder: WorkspaceFolder, display: Display): VSWorkspace = {
    new VSWorkspace(workspaceFolder, display)
  }
}
