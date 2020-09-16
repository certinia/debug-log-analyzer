package com.financialforce.lana

import com.financialforce.lana.commands.{LoadLogFile, ShowLogFile}
import com.financialforce.lana.runtime.vscode.ExtensionContext
import com.financialforce.lana.runtime.vscode.workspace.workspaceFolders
import com.financialforce.lana.workspace.Workspace
import com.nawforce.common.path.{PathFactory, PathLike}
/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import scala.concurrent.Future
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue

class Context(val context: ExtensionContext, val display: Display, val debugMode: Boolean) {

  val symbolFinder = new SymbolFinder()
  val workspaces: Seq[Workspace] = workspaceFolders map (Workspace(_, display))
  val namespaces: Seq[String] = Seq()

  register()

  def findSymbol(wsPath: String, symbol: String): Future[Option[PathLike]] = {
    try {
      symbolFinder.findSymbol(wsPath, symbol).toFuture.map(f => Some(PathFactory(f)))
    } catch {
      case ex: SymbolFinderError =>
        display.showErrorMessage(ex.getMessage)
        Future.successful(None)
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
