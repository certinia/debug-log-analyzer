/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  window,
  workspace,
  type QuickPick as VSCodeQuickPick,
  type QuickPickItem,
  type WebviewPanel,
} from 'vscode';
import { Utils } from 'vscode-uri';

import { appName } from '../AppSettings.js';
import type { Context } from '../Context.js';
import { Item, Options, QuickPick } from '../display/QuickPick.js';
import type { ApexLogListItem } from '../services/salesforceServices.js';
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
  private static servicesDisposalRegistered = false;

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
    const salesforceServices = await import('../services/salesforceServices.js');
    if (!(await salesforceServices.ensureServicesAvailable())) {
      return;
    }

    // Disposal is registered here, not in deactivate(), so shutdown never loads this chunk
    // when the command was not used.
    if (!RetrieveLogFile.servicesDisposalRegistered) {
      RetrieveLogFile.servicesDisposalRegistered = true;
      context.context.subscriptions.push({
        dispose: () => {
          salesforceServices.disposeServices().catch(() => {});
        },
      });
    }

    const workspaceFolder = workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace selected');
    }
    const loadingPicker = RetrieveLogFile.showLoadingPicker();
    try {
      const logFiles = await salesforceServices.listLogs();
      const logFileId = await RetrieveLogFile.getLogFile(logFiles);
      if (logFileId) {
        const logUri = Utils.joinPath(
          workspaceFolder.uri,
          '.sfdx',
          'tools',
          'debug',
          'logs',
          `${logFileId}.log`,
        );
        if (await salesforceServices.fileOrFolderExists(logUri)) {
          return LogView.createView(context, Promise.resolve(), logUri);
        }

        // Open the panel first and retrieve behind it. The body only crosses the webview
        // message channel when it could not be cached, so the webview streams it from disk.
        const retrieveLog = (async (): Promise<string | void> => {
          const logData = await salesforceServices.getLogBody(logFileId);
          RetrieveLogFile.assertRetrievedLog(logFileId, logData);
          try {
            await salesforceServices.writeFile(logUri, logData);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            context.display.output(`Unable to cache retrieved log: ${message}`, true);
            return logData;
          }
        })();
        return LogView.createView(context, retrieveLog, logUri);
      }
    } finally {
      loadingPicker.dispose();
    }
  }

  private static showLoadingPicker(): VSCodeQuickPick<QuickPickItem> {
    const qp = window.createQuickPick();
    qp.placeholder = 'Select a logfile';
    qp.busy = true;
    qp.enabled = false;
    qp.show();
    return qp;
  }

  private static async getLogFile(files: ApexLogListItem[]): Promise<string | null> {
    const items = files
      .sort((a, b) => {
        const aDate = Date.parse(a.StartTime);
        const bDate = Date.parse(b.StartTime);
        return bDate - aDate;
      })
      .map((r) => {
        const name = `${r.LogUser?.Name ?? 'Unknown user'} - ${r.Operation ?? 'Unknown operation'}`;
        const description = `${(r.LogLength / 1024).toFixed(2)} KB ${this.formatDuration(r.DurationMilliseconds ?? 0)}`;
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

  private static assertRetrievedLog(logId: string, logData: string): void {
    if (/^access\s*denied$/i.test(logData.trim())) {
      throw new Error(
        `Salesforce denied access to the body of Apex log ${logId}. Verify that the authenticated user can access ApexLog records and their bodies.`,
      );
    }
  }
}
