/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana

import com.financialforce.lana.commands.{LoadLogFile, ShowLogFile}
import com.financialforce.lana.runtime.vscode.ExtensionContext
import com.financialforce.lana.runtime.vscode.workspace.workspaceFolders
import com.financialforce.lana.workspace.VSWorkspace

import scala.scalajs.js

class Context(val context: ExtensionContext, val display: Display, val debugMode: Boolean) {

  val symbolFinder = new SymbolFinder()
  val workspaces: Seq[VSWorkspace] = workspaceFolders.getOrElse(js.Array()) map (VSWorkspace(_, display))
  val namespaces: Seq[String] = Seq()

  register()

  def findSymbol(wsPath: String, symbol: String): Option[String] = {
    try {
      Some(symbolFinder.findSymbol(wsPath, symbol))
    } catch {
      case ex: Exception =>
        display.showErrorMessage(ex.getMessage)
        None
    }
  }

  private def register(): Unit = {
    LoadLogFile(this)
    ShowLogFile(this)
  }
}

object Context {
  def apply(context: ExtensionContext, display: Display, debugMode: Boolean): Context = {
    new Context(context, display, debugMode)
  }
}
