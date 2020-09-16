/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana

import com.financialforce.lana.runtime.vscode.ExtensionContext

import scala.concurrent.Future
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue
import scala.scalajs.js
import scala.scalajs.js.JSConverters._
import scala.scalajs.js.annotation.JSExportTopLevel

class InitConfig(val debug: Boolean) extends js.Object

object Main {

  val appName: String = "Lana"
  var context: Option[Context] = None

  @JSExportTopLevel("activate")
  def activate(context: ExtensionContext, config: InitConfig): js.Promise[js.Object] = {
    this.context = Some(Context(context, Display(context), config.debug))
    Future(js.Object()).toJSPromise
  }

  @JSExportTopLevel("deactivate")
  def deactivate(): Unit = {
    this.context = None
  }

}
