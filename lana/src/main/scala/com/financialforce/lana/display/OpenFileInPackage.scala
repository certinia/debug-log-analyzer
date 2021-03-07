/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.display

import com.financialforce.lana.Context
import com.financialforce.lana.runtime.vscode._

import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue

object OpenFileInPackage {

  def openFileForSymbol(wsPath: String, context: Context, name: String, line: Option[Int]): Unit = {
    context
      .findSymbol(wsPath, name)
      .foreach(path => {
        val uri = Uri.file(path.toString)
        workspace
          .openTextDocument(uri)
          .toFuture
          .flatMap(window.showTextDocument(_).toFuture.map { editor =>
            line.foreach(line => {
              val position = new Position(line, character = 0)
              editor.revealRange(new Range(position, position))
            })
          })
      })
  }
}
