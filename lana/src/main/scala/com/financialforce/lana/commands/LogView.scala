/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.commands

import com.financialforce.lana.Context
import com.financialforce.lana.display.{OpenFileInPackage, WebView}
import com.financialforce.lana.runtime.vscode.WebviewPanel
import io.scalajs.nodejs.buffer.Buffer
import io.scalajs.nodejs.fs.Fs
import io.scalajs.nodejs.path.Path

import scala.scalajs.js
import scala.scalajs.js.annotation.JSGlobal
import scala.util.Try

@JSGlobal
@js.native
class WebViewLogFileRequest extends js.Object {
  val text: js.UndefOr[String] = js.native
  val typeName: js.UndefOr[String] = js.native
  val path: js.UndefOr[String] = js.native
}

class LogFileException(message: String) extends Exception(message)

trait LogView {
  def createView(wsPath: String,
                 context: Context,
                 logName: String,
                 logPath: String,
                 logContents: String): WebviewPanel = {
    val panel = WebView("logFile", "Log: " + logName, Seq())
    panel.webview.html = getViewContent(context, logName, logPath, logContents)
    // handle callbacks
    panel.webview.onDidReceiveMessage({ a: js.Any =>
      {
        val request: WebViewLogFileRequest = a.asInstanceOf[WebViewLogFileRequest]

        if (request.typeName.nonEmpty) {
          val parts = request.typeName.get.split("-")
          val line = if (parts.length > 1) Try(parts(1).toInt).toOption else None
          OpenFileInPackage.openFileForSymbol(wsPath, context, parts.head, line)
        } else {
          request.path.foreach(context.display.showFile)
        }
      }
    }, js.undefined, js.Array())
    panel
  }

  private def getViewContent(context: Context,
                             logName: String,
                             logPath: String,
                             logContents: String): String = {
    val namespaces: Seq[String] = context.namespaces
    val spaRoot: String = Path.join(context.context.extensionPath, "spa", "log-viewer")
    val index: String = Path.join(spaRoot, "index.html")
    val bundle: String = Path.join(spaRoot, "bundle.js")
    val indexSrc: String = string(Fs.readFileSync(index))
    val bundleSrc: String = string(Fs.readFileSync(bundle))
    val htmlWithLog = insertAtToken(indexSrc, "@@logTxt", logContents)
    val htmlWithLogName = insertAtToken(htmlWithLog, "@@name", logName)
    val htmlWithLogPath = insertAtToken(htmlWithLogName, "@@path", logPath)
    val htmlWithNS = insertAtToken(htmlWithLogPath, "@@ns", namespaces.mkString(","))
    val htmlWithBundle = insertAtToken(htmlWithNS, "@@bundle", bundleSrc)
    htmlWithBundle
  }

  private def string(buf: Buffer): String = {
    buf.toString("utf8", 0, buf.length)
  }

  private def insertAtToken(str: String, token: String, insert: String): String = {
    if (str.indexOf(token) > -1) {
      val splits = str.split(token)
      return splits(0) + insert + splits(1)
    }
    str
  }
}
