/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.commands

import com.financialforce.lana.Context
import com.financialforce.lana.runtime.vscode.commands

import scala.scalajs.js

class Command(private val name: String, private val run: js.Function) {
  private val commandPrefix = "lana."

  def register(c: Context): this.type = {
    val fullName = commandPrefix + name
    val command = commands.registerCommand(fullName, run)
    c.context.subscriptions += command
    this
  }
}

object Command {
  def apply(name: String, run: js.Function): Command = new Command(name, run)
}
