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
    sticky = true,
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
      return await RetrieveLogFile.command(context);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      context.display.showErrorMessage(`Error loading logfile: ${msg}`);
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
        const description = `${(r.LogLength / 1024).toFixed(2)} KB ${this.formatDuration(r.DurationMilliseconds)}`;
        const detail = `${new Date(r.StartTime).toLocaleString()} - ${r.Status} - ${r.Id}`;
        return new DebugLogItem(name, description, detail, r.Id);
      });

    const [selectedLog] = await QuickPick.pick(items, new Options('Select a logfile'));
    return selectedLog?.logId || null;
  }

  /**
   * Formats a duration in milliseconds into a human-readable string.
   *
   * The function automatically selects the most appropriate unit (milliseconds, seconds, or minutes)
   * based on the duration value and applies appropriate precision rounding.
   *
   * @param ms - The duration in milliseconds to format
   * @returns A formatted string representing the duration with appropriate units:
   *   - Values < 1000ms: returns in milliseconds (e.g., "1.23 ms", "45.6 ms", "789 ms")
   *   - Values < 60s: returns in seconds (e.g., "1.23 s", "45.6 s")
   *   - Values >= 60s: returns in minutes and seconds (e.g., "2m", "2m 30s", "5m 15.5s")
   *
   * @example
   * formatDuration(500)      // "500 ms"
   * formatDuration(1500)     // "1.5 s"
   * formatDuration(120000)   // "2m"
   * formatDuration(150000)   // "2m 30s"
   */
  private static formatDuration(ms: number) {
    if (!ms) {
      return '0 ms';
    }

    if (ms < 1000) {
      const precision = ms < 10 ? 100 : ms < 100 ? 10 : 1;
      return `${this._round(ms, precision)} ms`;
    }

    const s = ms / 1000;
    if (s < 60) {
      const precision = s < 10 ? 100 : s < 100 ? 10 : 1;
      return `${this._round(s, precision)} s`;
    }

    const m = Math.floor(s / 60);
    const sec = s % 60;

    if (sec === 0) {
      return `${m}m`;
    }

    const secStr = sec === Math.floor(sec) ? `${sec}s` : `${this._round(sec, 10)}s`;
    return `${m}m ${secStr}`;
  }

  private static _round(value: number, precision: number): number {
    return Math.round(value * precision) / precision;
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
