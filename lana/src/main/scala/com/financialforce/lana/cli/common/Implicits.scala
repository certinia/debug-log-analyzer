/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.cli.common

import scala.concurrent.Future
import scala.concurrent.Future.{failed, successful}
import scala.util.{Failure, Success, Try}

private[cli] object Implicits {

  implicit class TryToFuture[T](t: Try[T]) {
    def toFuture: Future[T] = t match {
      case Success(r)  => successful(r)
      case Failure(ex) => failed(ex)
    }
  }

}
