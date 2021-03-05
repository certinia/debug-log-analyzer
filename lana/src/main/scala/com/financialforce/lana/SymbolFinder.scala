/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana

import scala.scalajs.js
import scala.scalajs.js.annotation.JSImport

@js.native
@JSImport("pkgforce", "Workspaces")
object Workspaces extends js.Object {
  def get(path: String): Workspace = js.native
}

@js.native
@JSImport("pkgforce", "Workspace")
class Workspace extends js.Object {
  def findType(typeName: String): String = js.native
}

class SymbolFinderError(err: String) extends Exception(err)

class SymbolFinder {

  def findSymbol(wsPath: String, symbol: String): String = {
    val ws = Workspaces.get(wsPath)
    Option(ws.findType(symbol)) match {
      case None =>
        throw new SymbolFinderError(s"Symbol $symbol not found")
      case Some(path) =>
        path
    }
  }
}
