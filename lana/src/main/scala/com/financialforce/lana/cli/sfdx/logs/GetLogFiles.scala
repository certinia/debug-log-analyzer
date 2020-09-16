/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.cli.sfdx.logs

import com.financialforce.lana.cli.common.Implicits.TryToFuture
import com.financialforce.lana.cli.common.JSON
import com.financialforce.lana.cli.sfdx.{SFDX, SFDXResponse}

import scala.concurrent.Future
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue
import scala.scalajs.js
import scala.scalajs.js.annotation.JSGlobal

@js.native
@JSGlobal
class GetLogFilesResult(val Id: String,
                        val Application: String,
                        val DurationMilliseconds: Int,
                        val Location: String,
                        val LogLength: Int,
                        val Operation: String,
                        val Request: String,
                        val StartTime: String,
                        val Status: String)
    extends js.Object

object GetLogFiles {
  def apply(path: String): Future[SFDXResponse[js.Array[GetLogFilesResult]]] =
    SFDX(path, Seq("force:apex:log:list", "--json")) flatMap { str =>
      JSON.parse[SFDXResponse[js.Array[GetLogFilesResult]]](str).toFuture
    }
}
