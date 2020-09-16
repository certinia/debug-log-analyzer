/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana

import com.financialforce.lana.display.QuickPickFileOpen
import com.financialforce.lana.runtime.vscode
import com.financialforce.lana.runtime.vscode.{ExtensionContext, TextEditor, Uri, window}

import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue

class Display(extensionContext: ExtensionContext) {
  val pluginName = "Lana"
  private val outputChannel = window.createOutputChannel(pluginName)

  def output(message: String, showChannel: Boolean = false): Unit = {
    if (showChannel)
      outputChannel.show(preserveFocus = true)
    outputChannel.appendLine(message)
  }

  def showInformationMessage(s: String): Unit = vscode.window.showInformationMessage(s)

  def showErrorMessage(s: String): Unit = vscode.window.showErrorMessage(s)

  def showFile(path: String): Unit = {
    vscode.workspace
      .openTextDocument(Uri.file(path))
      .toFuture
      .map(td => vscode.window.showTextDocument(td))
  }

  def getActiveTextEditor: Option[TextEditor] = Option(vscode.window.activeTextEditor) match {
    case Some(undef) => undef.toOption
    case None        => None
  }

  object QuickPickFileOpen {

    def apply(message: String, multiSelect: Boolean): QuickPickFileOpen =
      new QuickPickFileOpen(message, multiSelect)

  }

}

object Display {
  def apply(extensionContext: ExtensionContext): Display = new Display(extensionContext)
}
