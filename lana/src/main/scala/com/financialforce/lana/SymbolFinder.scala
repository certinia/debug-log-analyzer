/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana

import com.nawforce.common.api.{Name, TypeName}
import com.nawforce.common.diagnostics.CatchingLogger
import com.nawforce.common.documents.DocumentIndex
import com.nawforce.common.path.PathFactory
import com.nawforce.common.sfdx.{MDAPIWorkspace, Project, SFDXWorkspace}

import scala.collection.mutable
import scala.concurrent.Future
import scala.scalajs.concurrent.JSExecutionContext.Implicits.queue
import scala.scalajs.js
import scala.scalajs.js.JSConverters._

class SymbolFinderError(err: String) extends Exception(err)

class SymbolFinder {
  private val workspaceDocumentIndexes = new mutable.HashMap[String, DocumentIndex]()

  def findSymbol(wsPath: String, symbol: String): js.Promise[String] = {
    val index = getIndex(wsPath)
    val typeName = TypeName(symbol.split('.').take(2).map(Name(_)).reverse)
    val result = index.getByType(typeName) match {
      case None =>
        Future.failed(new SymbolFinderError(s"Symbol $symbol not found"))
      case Some(metadataDocument) =>
        Future.successful(metadataDocument.path.toString)
    }
    result.toJSPromise
  }

  def getIndex(wsPath: String): DocumentIndex = {
    workspaceDocumentIndexes.getOrElseUpdate(
      wsPath, {
        val path = PathFactory(wsPath)
        val ws =
          if (path.join("sfdx-project.json").exists) {
            Project(path) match {
              case Left(err) =>
                throw new SymbolFinderError(err)
              case Right(project) =>
                new SFDXWorkspace(path, project)
            }
          } else {
            new MDAPIWorkspace(None, Seq(path))
          }
        val logger = new CatchingLogger()
        new DocumentIndex(ws.namespace, ws.paths, logger, ws.forceIgnore)
      })
  }
}
