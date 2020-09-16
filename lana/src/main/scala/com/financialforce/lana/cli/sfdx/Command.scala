/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.cli.sfdx

import com.financialforce.lana.cli.common.JSON
import io.scalajs.nodejs
import io.scalajs.nodejs.buffer.Buffer
import io.scalajs.nodejs.child_process.{ChildProcess, ExecOptions}

import scala.concurrent.{Future, Promise}
import scala.scalajs.js
import scala.scalajs.js.annotation.JSGlobal
import scala.scalajs.js.|

@js.native
@JSGlobal
class GenericError(val message: String) extends js.Object

object Command {

  type Handler = js.Function3[nodejs.Error, Buffer | String, Buffer | String, Any]

  private val encoding: String = "utf8"

  def apply(path: String, command: Seq[String]): Future[String] = {
    val p = Promise[String]
    run(path,
        command,
        (error: nodejs.Error, stdOut: Buffer | String, stdErr: Buffer | String) => {
          if (error == null) {
            val out = stdOut.asInstanceOf[Buffer]
            p.success(out.toString(encoding, 0, out.length))
          } else {
            p.failure(attemptErrorParse(error, stdOut.asInstanceOf[Buffer]))
          }
        })
    p.future
  }

  private def attemptErrorParse(error: nodejs.Error, stdOut: Buffer): Exception = {
    val out = stdOut.toString(encoding, 0, stdOut.length)
    if (out != null && out.length > 0) {
      // sometimes we get detailed message fields back on stdout in json objects
      val tryGenericError = JSON.parse[GenericError](out)
      new Exception(tryGenericError map (_.message) getOrElse error.message)
    } else {
      new Exception(error.message)
    }
  }

  private def run(path: String, command: Seq[String], handler: Handler): ChildProcess = {
    ChildProcess.exec(command.mkString(" "), new ExecOptions(cwd = path), handler)
  }

}
