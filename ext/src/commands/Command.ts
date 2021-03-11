/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { commands } from "vscode";
import { Context } from "../Context";

export class Command {
  private static commandPrefix = "lana.";

  name: string;
  run: (...args: any[]) => any;

  constructor(name: string, run: (...args: any[]) => any) {
    this.name = name;
    this.run = run;
  }

  register(c: Context): Command {
    const fullName = Command.commandPrefix + this.name;
    const command = commands.registerCommand(fullName, run);
    c.context.subscriptions.push(command);
    return this;
  }
}
