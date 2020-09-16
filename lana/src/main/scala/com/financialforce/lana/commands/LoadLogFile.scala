/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.commands

import com.financialforce.lana.cli.sfdx.SFDXResponse
import com.financialforce.lana.cli.sfdx.logs.{GetLogFile, GetLogFiles, GetLogFilesResult}
import com.financialforce.lana.display.{QuickPick, QuickPickWorkspace}
import com.financialforce.lana.runtime.vscode.WebviewPanel
import com.financialforce.lana.{Context, Main}
import io.scalajs.nodejs.fs.{Fs, MkdirOptions}
import io.scalajs.nodejs.path.Path

import scala.concurrent.Future
import scala.concurrent.Future._
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue
import scala.scalajs.js
import scala.scalajs.js.Date

object LoadLogFile extends LogView {
  def apply(context: Context): Unit = {
    Command("loadLogFile", () => command(context)).register(context)
    context.display.output(s"Registered command '${Main.appName}: Load Log'")
  }

  private def command(context: Context): Future[WebviewPanel] = {
    val cmd =
      QuickPickWorkspace.pickOrReturn(context) flatMap { ws =>
        getLogFiles(ws) flatMap
          getLogFile(context) flatMap { fileId =>
          readLogFile(ws)(fileId) map { lf =>
            createView(ws, context, fileId, lf._1, lf._2)
          }
        }
      }
    cmd.failed foreach { ex =>
      context.display.showErrorMessage(ex.getMessage)
    }
    cmd
  }

  private def getLogFiles(ws: String) = GetLogFiles(ws)

  private def getLogFile(context: Context)(
    result: SFDXResponse[js.Array[GetLogFilesResult]]): Future[String] = {
    QuickPick.pick(
      result.result sortWith { (i1, i2) =>
        Date.parse(i1.StartTime) > Date.parse(i2.StartTime)
      } map { r =>
        new QuickPick.Item(
          s"${new Date(r.StartTime).toLocaleString()} ${r.Operation}", "",
          s"${r.Id} ${r.Status} ${r.DurationMilliseconds}ms ${r.LogLength / 1024}kB")
      },
      new QuickPick.Options("Select a logfile:")) flatMap {
      case results if results.length == 1 => successful(results.head.detail.take(18))
      case _                              => failed(new Exception("No logfile selected"))
    }
  }

  def readLogFile(ws: String)(fileId: String): Future[(String, String)] = {
    GetLogFile(ws, fileId) map { contents =>
      val logDirectory = Path.join(ws, ".sfdx", "tools", "debug", "logs")
      val logFile = Path.join(logDirectory, s"$fileId.log")
      Fs.mkdirSync(logDirectory, new MkdirOptions(recursive = true))
      Fs.writeFileSync(logFile, contents)
      (logFile, contents)
    }
  }
}
