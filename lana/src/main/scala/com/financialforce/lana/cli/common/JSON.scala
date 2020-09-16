/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.cli.common

import io.scalajs.{JSON => native}

import scala.scalajs.js
import scala.util.Try

private[cli] object JSON {
  def parse[T <: js.Object](s: String): Try[T] = Try(native.parseAs[T](s))

  def stringify[T <: js.Object](t: T): String = native.stringify(t)
}
