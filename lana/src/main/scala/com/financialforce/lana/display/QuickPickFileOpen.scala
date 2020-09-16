/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.display

import com.financialforce.lana.runtime.vscode._

import scala.concurrent.Future
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue

class QuickPickFileOpen(message: String, multiSelect: Boolean) {

  type PickResult =
    (Future[Array[TextDocument]], Option[Future[Array[TextEditor]]] // if show is true
    )

  def pick(files: Array[(String, String)], show: Boolean): PickResult = {
    val documentFutures = QuickPick.pick(files map (f => new QuickPick.Item(f._1, f._2, "")),
                                         new QuickPick.Options(message)) map { items =>
      items.to[collection.immutable.Seq] map (x => Uri.file(x.label)) map { uri =>
        workspace.openTextDocument(uri).toFuture
      }
    } flatMap { documentFutures =>
      Future.foldLeft(documentFutures)(Array[TextDocument]())(_ :+ _)
    }
    if (show) {
      val textEditorFutures = documentFutures map { documents =>
        documents map (window.showTextDocument(_).toFuture)
      } flatMap { documents =>
        Future.foldLeft(documents.to[collection.immutable.Seq])(Array[TextEditor]())(_ :+ _)
      }
      return (documentFutures, Some(textEditorFutures))
    }
    (documentFutures, None)
  }

}
