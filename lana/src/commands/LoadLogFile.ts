/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Context } from "../Context";
import { Command } from "./Command";
import { LogView } from "./LogView";
import { appName } from "../Main";
import { WebviewPanel, window } from "vscode";
import { QuickPickWorkspace } from "../display/QuickPickWorkspace";
import { GetLogFiles, GetLogFilesResult } from "../sfdx/logs/GetLogFiles";
import { GetLogFile } from "../sfdx/logs/GetLogFile";
import * as path from "path";
import { promises as fsp } from "fs";
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
    } catch (err: any) {
      context.display.showErrorMessage(`Error loading logfile: ${err.message}`);
      return Promise.resolve();
    }
  }

  private static async command(context: Context): Promise<WebviewPanel | void> {
    const ws = await QuickPickWorkspace.pickOrReturn(context);
    const [loadingPicker, logFiles] = await Promise.all([
      LoadLogFile.showLoadingPicker(),
      GetLogFiles.apply(ws),
    ]);

    if (logFiles.status !== 0) {
      throw new Error("Failed to load available log files");
    }
    const logFileId = await LoadLogFile.getLogFile(logFiles.result);
    if (logFileId) {
      const logFilePath = this.getLogFilePath(ws, logFileId);
      const view = await LogView.createView(ws, context, logFilePath);
      await LoadLogFile.writeLogFile(ws, logFilePath);
      LogView.appendView(view, context, logFileId, logFilePath);
    }
  }

  private static async showLoadingPicker(): Promise<QuickPick> {
    const qp = window.createQuickPick();
    qp.placeholder = "Select a logfile";
    qp.busy = true;
    qp.enabled = false;
    qp.show();
    return qp;
  }

  private static async getLogFile(
    files: GetLogFilesResult[]
  ): Promise<string | null> {
    const items = files
      .sort((a, b) => {
        const aDate = Date.parse(a.StartTime);
        const bDate = Date.parse(b.StartTime);
        return bDate - aDate;
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
    if (picked.length === 1) {
      return picked[0].detail.slice(0, 18);
    }
    return null;
  }

  private static getLogFilePath(ws: string, fileId: string): string {
    const logDirectory = path.join(ws, ".sfdx", "tools", "debug", "logs");
    const logFilePath = path.join(logDirectory, `${fileId}.log`);
    return logFilePath;
  }

  private static async writeLogFile(ws: string, logPath: string) {
    const logExists = fs.existsSync(logPath);
    if (!logExists) {
      const log = path.parse(logPath);
      const logDir = log.dir;
      const logId = log.name;

      const logContent = await GetLogFile.apply(ws, logId);
      await fsp.mkdir(logDir, { recursive: true });
      await fsp.writeFile(logPath, logContent);
    }
  }
}
