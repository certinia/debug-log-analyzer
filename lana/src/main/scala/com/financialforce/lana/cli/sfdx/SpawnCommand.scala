/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.cli.sfdx

import com.financialforce.lana.cli.common.JSON
import io.scalajs.nodejs.buffer.Buffer
import io.scalajs.nodejs.child_process.{ChildProcess, SpawnOptions}

import scala.concurrent.Future._
import scala.concurrent.{Future, Promise}
import scala.scalajs.js
import scala.util.{Failure, Success, Try}

case class SpawnResult(complete: Future[Unit], emitter: Option[SpawnResultStream])

case class SpawnResultStream(private val proc: ChildProcess) {

  def onOut(f: Buffer => Unit): Unit = proc.stdout.on("data", f)

}

object SpawnCommand {

  private val encoding: String = "utf8"

  def apply(path: String, command: Seq[String]): SpawnResult = run(path, command)

  private def opts(path: String) = new SpawnOptions(cwd = path, stdio = "pipe", detached = true)

  private def run(path: String, command: Seq[String]): SpawnResult =
    Try(ChildProcess.spawn(command.head, js.Array(command.tail: _*), opts(path))) flatMap { proc =>
      {
        proc.pid.asInstanceOf[js.UndefOr[Int]].toOption match {
          case Some(pid) => Success((proc, pid))
          case _         => Failure(new Exception("Server proc PID not present. Process not created"))
        }
      }
    } match {
      case Success(procTuple) =>
        val proc = procTuple._1
        val completionPromise = Promise[Unit]
        var errorMsg: Option[String] = None
        var potentialDataErrorMsg: Option[Buffer] = None
        proc.on("error", { error: String =>
          errorMsg = Some(error)
        })
        proc.stderr.on("data", { data: Buffer =>
          potentialDataErrorMsg = Some(data)
        })
        proc.on(
          "exit", { (code: Int, _: Int) =>
            if (code == 0) {
              completionPromise.success(Unit)
            } else {
              completionPromise.failure(
                errorMsg map (new Exception(_))
                  getOrElse attemptErrorParse(potentialDataErrorMsg))
            }
          })
        SpawnResult(completionPromise.future, Some(SpawnResultStream(proc)))
      case Failure(ex) => SpawnResult(failed(ex), None)
    }

  private def attemptErrorParse(stdOut: Option[Buffer]): Exception = {
    stdOut match {
      case Some(stdOut) =>
        val out = stdOut.toString(encoding, 0, stdOut.length)
        if (out != null && out.length > 0) {
          // sometimes we get detailed message fields back on stdout in json objects
          val tryGenericError = JSON.parse[GenericError](out)
          new Exception(tryGenericError map (_.message) getOrElse "Unknown Error")
        } else {
          new Exception("Unknown Error")
        }
      case None => new Exception("Unknown Error")
    }
  }

}
