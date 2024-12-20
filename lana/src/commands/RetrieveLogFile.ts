/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { type LogRecord } from '@salesforce/apex-node';
import { existsSync } from 'fs';
import { join, parse } from 'path';
import { window, type WebviewPanel } from 'vscode';

import { appName } from '../AppSettings.js';
import { Context } from '../Context.js';
import { Item, Options, QuickPick } from '../display/QuickPick.js';
import { QuickPickWorkspace } from '../display/QuickPickWorkspace.js';
import { GetLogFile } from '../salesforce/logs/GetLogFile.js';
import { GetLogFiles } from '../salesforce/logs/GetLogFiles.js';
import { Command } from './Command.js';
import { LogView } from './LogView.js';

class DebugLogItem extends Item {
  logId: string;

  constructor(
    name: string,
    desc: string,
    details: string,
    logId: string,
    sticky = false,
    selected = false,
  ) {
    super(name, desc, details, sticky, selected);
    this.logId = logId;
  }
}

export class RetrieveLogFile {
  static apply(context: Context): void {
    new Command('retrieveLogFile', 'Log: Retrieve Apex Log And Show Analysis', () =>
      RetrieveLogFile.safeCommand(context),
    ).register(context);
    context.display.output(`Registered command '${appName}: Retrieve Log'`);
  }

  private static async safeCommand(context: Context): Promise<WebviewPanel | void> {
    try {
      return RetrieveLogFile.command(context);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      context.display.showErrorMessage(`Error loading logfile: ${msg}`);
      return Promise.resolve();
    }
  }

  private static async command(context: Context): Promise<WebviewPanel | void> {
    const ws = await QuickPickWorkspace.pickOrReturn(context);
    const [logFiles] = await Promise.all([
      GetLogFiles.apply(ws),
      RetrieveLogFile.showLoadingPicker(),
    ]);

    const logFileId = await RetrieveLogFile.getLogFile(logFiles);
    if (logFileId) {
      const logFilePath = this.getLogFilePath(ws, logFileId);
      const writeLogFile = this.writeLogFile(ws, logFilePath);
      return LogView.createView(context, writeLogFile, logFilePath);
    }
  }

  private static async showLoadingPicker(): Promise<QuickPick> {
    const qp = window.createQuickPick();
    qp.placeholder = 'Select a logfile';
    qp.busy = true;
    qp.enabled = false;
    qp.show();
    return qp;
  }

  private static async getLogFile(files: LogRecord[]): Promise<string | null> {
    const items = files
      .sort((a, b) => {
        const aDate = Date.parse(a.StartTime);
        const bDate = Date.parse(b.StartTime);
        return bDate - aDate;
      })
      .map((r) => {
        const name = `${r.LogUser.Name} - ${r.Operation}`;
        const description = `${(r.LogLength / 1024).toFixed(2)} KB ${r.DurationMilliseconds} ms`;
        const detail = `${new Date(r.StartTime).toLocaleString()} - ${r.Status} - ${r.Id}`;
        return new DebugLogItem(name, description, detail, r.Id);
      });

    const [selectedLog] = await QuickPick.pick(
      items,
      new Options({
        placeholder: 'Select a workspace:',
        matchOnDescription: true,
        matchOnDetail: true,
      }),
    );
    return selectedLog?.logId || null;
  }

  private static getLogFilePath(ws: string, fileId: string): string {
    const logDirectory = join(ws, '.sfdx', 'tools', 'debug', 'logs');
    const logFilePath = join(logDirectory, `${fileId}.log`);
    return logFilePath;
  }

  private static async writeLogFile(ws: string, logPath: string) {
    const logExists = existsSync(logPath);
    if (!logExists) {
      const logfilePath = parse(logPath);
      await GetLogFile.apply(ws, logfilePath.dir, logfilePath.name);
    }
  }
}
