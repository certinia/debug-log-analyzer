/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Context } from "../Context";
import { Command } from "./Command";
import { LogView } from "./LogView";
import { appName } from "../Main";
import { WebviewPanel } from "vscode";
import { QuickPickWorkspace } from "../display/QuickPickWorkspace";
import { GetLogFiles, GetLogFilesResult } from "../sfdx/logs/GetLogFiles";
import { GetLogFile } from "../sfdx/logs/GetLogFile";
import * as path from "path";
import * as fs from "fs";
import { Item, Options, QuickPick } from "../display/QuickPick";

export class LoadLogFile {
  static apply(context: Context): void {
    new Command("loadLogFile", () => LoadLogFile.safeCommand(context)).register(
      context
    );
    context.display.output(`Registered command '${appName}: Load Log'`);
  }

  private static async safeCommand(
    context: Context
  ): Promise<WebviewPanel | void> {
    try {
      return LoadLogFile.command(context);
    } catch (err) {
      context.display.showErrorMessage(`Error loading logfile: ${err.message}`);
      return Promise.resolve();
    }
  }

  private static async command(context: Context): Promise<WebviewPanel | void> {
    const ws = await QuickPickWorkspace.pickOrReturn(context);
    const logFiles = await GetLogFiles.apply(ws);
    if (logFiles.status != 0)
      throw new Error("Failed to load available log files");
    const logFileId = await LoadLogFile.getLogFile(logFiles.result);
    if (logFileId) {
      const contents = await LoadLogFile.readLogFile(ws, logFileId);
      return LogView.createView(ws, context, logFileId, contents[0], contents[1]);
    }
  }

  private static async getLogFile(files: GetLogFilesResult[]): Promise<string | null> {
    const items = files
      .sort((a, b) => {
        const aDate = Date.parse(a.StartTime);
        const bDate = Date.parse(b.StartTime);
        if (aDate == bDate) return 0;
        else if (aDate < bDate) return -1;
        return 1;
      })
      .map((r) => {
        return new Item(
          `${new Date(r.StartTime).toLocaleString()} ${r.Operation}`,
          "",
          `${r.Id} ${r.Status} ${r.DurationMilliseconds}ms ${
            r.LogLength / 1024
          }kB`
        );
      });

    const picked = await QuickPick.pick(items, new Options("Select a logfile"));
    if (picked.length == 1) 
      return picked[0].detail.slice(0, 18);
    else
      return null;
  }

  private static async readLogFile(
    ws: string,
    fileId: string
  ): Promise<[string, string]> {
    const contents = await GetLogFile.apply(ws, fileId);
    const logDirectory = path.join(ws, ".sfdx", "tools", "debug", "logs");
    const logFile = path.join(logDirectory, `${fileId}.log`);
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.writeFileSync(logFile, contents);
    return [logFile, contents];
  }
}
