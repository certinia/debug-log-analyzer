/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { exec, ExecException, ChildProcess } from "child_process";

type Handler = (
  error: ExecException | null,
  stdout: Buffer | string,
  stderr: Buffer | string
) => void;

export class Command {
  static async apply(path: string, command: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      Command.run(
        path,
        command,
        (
          error: ExecException | null,
          stdOut: Buffer | String,
          stdErr: Buffer | String
        ) => {
          if (error === null) {
            const out = stdOut as Buffer;
            resolve(out.toString("utf8"));
          } else {
            reject(Command.attemptErrorParse(error, stdOut as Buffer));
          }
        }
      );
    });
  }

  private static attemptErrorParse(
    error: ExecException | null,
    stdOut: Buffer
  ): Error {
    const out = stdOut.toString("utf-8");
    if (out !== null && out.length > 0) {
      // sometimes we get detailed message fields back on stdout in json objects
      try {
        const tryGenericError = JSON.parse(out) as Error;
        return new Error(tryGenericError?.message);
      } catch {
        // Drop through
      }
    }
    return new Error(error?.message);
  }

  private static run(
    path: string,
    command: string[],
    handler: Handler
  ): ChildProcess {
    return exec(
      command.join(" "),
      { cwd: path, maxBuffer: 21 * 1024 * 1024 },
      handler
    );
  }
}
