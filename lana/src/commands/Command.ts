/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { commands } from 'vscode';

import type { Context } from '../Context.js';

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
    try {
      return await this.handler(...args);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.context.display.showErrorMessage(`${this.errorPrefix}: ${message}`);
      return undefined;
    }
  };

  register(): Command {
    const command = commands.registerCommand(this.fullName, this.run);
    this.context.context.subscriptions.push(command);
    return this;
  }
}
