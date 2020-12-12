/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.commands

import com.financialforce.lana.display.QuickPickWorkspace
import com.financialforce.lana.runtime.vscode.{Uri, window}
import com.financialforce.lana.{Context, Main}
import io.scalajs.nodejs.fs.Fs
import io.scalajs.nodejs.path.Path

import scala.concurrent.Future
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue
import scala.scalajs.js

object ShowLogFile extends LogView {
  def apply(context: Context): Unit = {
    Command("showLogFile", (uri: Uri) => command(context, uri)).register(context)
    context.display.output(s"Registered command '${Main.appName}: Show Log'")
  }

  private def command(context: Context, uri: Uri): Future[Unit] = {
    val filePath = if (js.isUndefined(uri)) {
      window.activeTextEditor.map(_.document.uri.fsPath).toOption
    } else {
      Some(uri.fsPath)
    }

    filePath.map(filePath => {
      val cmd =
        QuickPickWorkspace.pickOrReturn(context) flatMap { wsPath =>
          val name = Path.parse(filePath).name.getOrElse("Unknown")
          val fileContents = Fs.readFileSync(filePath, "utf-8")
          createView(wsPath, context, name, filePath, fileContents)
          Future.successful(())
        }
      cmd.failed foreach { ex =>
        context.display.showErrorMessage(ex.getMessage)
      }
      cmd
    }).getOrElse {
      context.display.showErrorMessage("No file selected to display log analysis")
      Future.successful(())
    }
  }
}
