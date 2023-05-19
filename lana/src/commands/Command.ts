/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { commands } from 'vscode';
import { Context } from '../Context';

export class Command {
  private static commandPrefix = 'lana.';

  name: string;
  fullName: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (...args: any[]) => any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(name: string, title: string, run: (...args: any[]) => any) {
    this.name = name;
    this.fullName = Command.commandPrefix + this.name;
    this.title = title;
    this.run = run;
  }

  register(c: Context): Command {
    const command = commands.registerCommand(this.fullName, this.run);
    c.context.subscriptions.push(command);
    return this;
  }
}
