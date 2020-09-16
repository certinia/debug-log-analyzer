/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.display

import com.financialforce.lana.Context

import scala.concurrent.Future
import scala.concurrent.Future.{failed, successful}
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue

object QuickPickWorkspace {

  def pickOrReturn(context: Context): Future[String] =
    if (context.workspaces.length > 1) {
      QuickPick.pick(context.workspaces map { ws =>
        new QuickPick.Item(ws.name, ws.path, "")
      }, new QuickPick.Options("Select a workspace:")) flatMap {
        case results if results.length == 1 => successful(results.head.description)
        case _                              => failed(new Exception("No workspace selected"))
      }
    } else {
      successful(context.workspaces.head.path)
    }

}
