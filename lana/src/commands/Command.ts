/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { commands } from 'vscode';

import type { Context } from '../Context.js';
import { tryCatchAsync } from '../tryCatch.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CommandHandler = (...args: any[]) => unknown;

export class Command {
  private static commandPrefix = 'lana.';

  name: string;
  fullName: string;
  title: string;

  private context: Context;
  private errorPrefix: string;
  private handler: CommandHandler;

  constructor(
    name: string,
    title: string,
    context: Context,
    errorPrefix: string,
    handler: CommandHandler,
  ) {
    this.name = name;
    this.fullName = Command.commandPrefix + this.name;
    this.title = title;
    this.context = context;
    this.errorPrefix = errorPrefix;
    this.handler = handler;
  }

  run = async (...args: unknown[]): Promise<unknown> => {
    const [result, error] = await tryCatchAsync(async () => this.handler(...args));
    if (error) {
      this.context.display.showErrorMessage(`${this.errorPrefix}: ${error.message}`);
      return undefined;
    }
    return result;
  };

  register(): Command {
    const command = commands.registerCommand(this.fullName, this.run);
    this.context.context.subscriptions.push(command);
    return this;
  }
}
