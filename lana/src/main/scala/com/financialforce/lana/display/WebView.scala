/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.display

import com.financialforce.lana.runtime.vscode.{Uri, WebviewPanel, WebviewPanelOptions, window}

import scala.scalajs.js

class WebViewOptions(resourceRoots: Seq[Uri]) extends WebviewPanelOptions {
  override val enableCommandUris: Boolean = true
  override val enableScripts: Boolean = true
  override val retainContextWhenHidden: Boolean = true
  override val localResourceRoots: js.Array[Uri] = js.Array(resourceRoots: _*)
  override val enableFindWidget: Boolean = true
}

object WebView {
  def apply(name: String, title: String, resourceRoots: Seq[Uri]): WebviewPanel =
    window.createWebviewPanel(name, title, -1, new WebViewOptions(resourceRoots))
}
