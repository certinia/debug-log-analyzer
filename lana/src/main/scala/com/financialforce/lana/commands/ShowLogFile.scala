/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.commands

import com.financialforce.lana.display.QuickPickWorkspace
import com.financialforce.lana.runtime.vscode.{Uri, WebviewPanel}
import com.financialforce.lana.{Context, Main}
import io.scalajs.nodejs.fs.Fs
import io.scalajs.nodejs.path.Path

import scala.concurrent.Future
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue

object ShowLogFile extends LogView {
  def apply(context: Context): Unit = {
    Command("showLogFile", (uri: Uri) => command(context, uri)).register(context)
    context.display.output(s"Registered command '${Main.appName}: Show Log'")
  }

  private def command(context: Context, uri: Uri): Future[WebviewPanel] = {
    val cmd =
      QuickPickWorkspace.pickOrReturn(context) flatMap { wsPath =>
        val filePath = uri.path
        val name = Path.parse(filePath).name.getOrElse("Unknown")
        val fileContents = Fs.readFileSync(filePath, "utf-8")
        Future.successful(createView(wsPath, context, name, filePath, fileContents))
      }
    cmd.failed foreach { ex =>
      context.display.showErrorMessage(ex.getMessage)
    }
    cmd
  }

}
