/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.cli.sfdx.logs

import com.financialforce.lana.cli.sfdx.SFDX

import scala.concurrent.Future

object GetLogFile {
  def apply(path: String, logId: String): Future[String] =
    SFDX(path, Seq("force:apex:log:get", "--logid", logId))
}
