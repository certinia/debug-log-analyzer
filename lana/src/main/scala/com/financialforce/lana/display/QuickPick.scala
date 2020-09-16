package com.financialforce.lana.display

import com.financialforce.lana.runtime.vscode.{QuickPickItem, QuickPickOptions, window}

import scala.concurrent.Future
/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue
import scala.scalajs.js
import scala.scalajs.js.|

object QuickPick {

  implicit class UndefOrCast[T](r: js.UndefOr[T]) {
    def safeOption: Option[T] = Option(r) flatMap (_.toOption)
  }

  class Item(name: String, desc: String, details: String, sticky: Boolean = true, selected: Boolean = false)
      extends QuickPickItem {
    override val alwaysShow: Boolean = sticky
    override val label: String = name
    override val description: String = desc
    override val detail: String = details
    override val picked: Boolean = selected
  }

  class Options(placeholder: String, ignoreDefocus: Boolean = false, multiSelect: Boolean = false)
      extends QuickPickOptions {
    override val canPickMany: Boolean = multiSelect
    override val ignoreFocusOut: Boolean = ignoreDefocus
    override val placeHolder: String = placeholder
  }

  def pick[T <: Item, U <: Options](items: Seq[T], options: U): Future[Seq[T]] =
    showQuickPick(js.Array(items: _*), options).toFuture map { oneOrMany =>
      val defined = oneOrMany.safeOption.isDefined
      val safe = oneOrMany.safeOption.getOrElse(js.Array[T]())
      if (options.canPickMany || !defined)
        safe.asInstanceOf[js.Array[T]]
      else
        js.Array(safe.asInstanceOf[T])
    } map { arr =>
      arr.toSeq
    }

  private def showQuickPick[T <: QuickPickItem](
    items: js.Array[T],
    options: QuickPickOptions): js.Promise[js.UndefOr[T | js.Array[T]]] = {
    window.showQuickPick[T](items, options, js.undefined)
  }
}
