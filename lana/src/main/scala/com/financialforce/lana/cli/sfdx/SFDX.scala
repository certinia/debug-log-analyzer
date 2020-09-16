/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.cli.sfdx

import scala.concurrent.Future
import scala.scalajs.js
import scala.scalajs.js.annotation.JSGlobal

@js.native
@JSGlobal
class SFDXResponse[T <: js.Any](val status: Int, val result: T) extends js.Object

object SFDX {
  def apply(path: String, args: Seq[String]): Future[String] = Command(path, Seq("sfdx") ++ args)
}
