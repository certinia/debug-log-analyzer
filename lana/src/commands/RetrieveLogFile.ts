/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  window,
  workspace,
  type Disposable,
  type QuickPick as VSCodeQuickPick,
  type QuickPickItem,
  type WebviewPanel,
} from 'vscode';
import { Utils } from 'vscode-uri';

import { appName } from '../AppSettings.js';
import { ApexLogCache, logIdsIn } from '../cache/ApexLogCache.js';
import type { Context } from '../Context.js';
import type { TargetOrg } from '../services/salesforceServices.js';
import { errorMessage } from '../tryCatch.js';
import { ClearApexLogCache } from './ClearApexLogCache.js';
import { Command } from './Command.js';
import type { LogStore } from './LogContentSearch.js';
import { pickLog } from './LogPicker.js';
import { LogView } from './LogView.js';

type SalesforceServices = typeof import('../services/salesforceServices.js');

export class RetrieveLogFile {
  private static servicesDisposalRegistered = false;

  static apply(context: Context): void {
    new Command(
      'retrieveLogFile',
      'Log: Retrieve Apex Log And Show Analysis',
      context,
      'Error loading logfile',
      () => RetrieveLogFile.command(context),
    ).register();
    context.display.output(`Registered command '${appName}: Retrieve Log'`);
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
      const logFiles = await RetrieveLogFile.whileLoading(loadingPicker, (signal) =>
        salesforceServices.listLogs(signal),
      );
      if (logFiles === undefined) {
        return;
      }
      const targetOrg = await RetrieveLogFile.targetOrg(context, salesforceServices);
      const orgId = targetOrg.orgId || undefined;
      const openedFolder = Utils.joinPath(
        workspaceFolder.uri,
        '.sfdx',
        'tools',
        'debug',
        'logs',
        ...(orgId ? [orgId] : []),
      );
      const openedUri = (logId: string) => Utils.joinPath(openedFolder, `${logId}.log`);
      const inOrg = new Set(logFiles.map((log) => log.Id));
      const cache = ApexLogCache.for(context);
      cache
        .pruneByAge()
        .catch((error: unknown) =>
          context.display.output(`Unable to prune the Apex log cache: ${errorMessage(error)}`),
        );
      const [openedIds, searchIds] = await Promise.all([
        logIdsIn(openedFolder).then((ids) => new Set(ids.filter((logId) => inOrg.has(logId)))),
        cache.logIds(orgId, orgId ? inOrg : undefined),
      ]);

      const store: LogStore = {
        has: (logId) => openedIds.has(logId) || searchIds.has(logId),
        read: async (logId) =>
          openedIds.has(logId) ? workspace.fs.readFile(openedUri(logId)) : cache.read(orgId, logId),
        download: async (logId) => {
          const body = await salesforceServices.getLogBody(logId);
          RetrieveLogFile.assertRetrievedLog(logId, body);
          return body;
        },
        write: async (logId, body) => {
          await cache.write(orgId, logId, body);
          searchIds.add(logId);
        },
      };
      const logLengths = new Map(logFiles.map((log) => [log.Id, log.LogLength]));
      const searchCacheSize = () => ({
        count: searchIds.size,
        bytes: [...searchIds].reduce((total, logId) => total + (logLengths.get(logId) ?? 0), 0),
      });

      const logFileId = await pickLog({
        logs: logFiles,
        store,
        placeholder: RetrieveLogFile.placeholder(targetOrg),
        cache: {
          size: searchCacheSize,
          clear: async () => {
            const org = targetOrg.alias ?? targetOrg.username ?? 'this org';
            if (!(await ClearApexLogCache.confirm(searchCacheSize(), `for ${org}`))) {
              return false;
            }
            await cache.clear(orgId);
            searchIds.clear();
            return true;
          },
        },
        output: (message) => context.display.output(message),
      });
      if (logFileId) {
        const logUri = openedUri(logFileId);
        if (openedIds.has(logFileId)) {
          return LogView.createView(context, Promise.resolve(), logUri);
        }

        // Open the panel first and retrieve behind it. The body only crosses the webview
        // message channel when it could not be cached, so the webview streams it from disk.
        const retrieveLog = (async (): Promise<string | void> => {
          const logData = searchIds.has(logFileId)
            ? new TextDecoder().decode(await cache.read(orgId, logFileId))
            : await store.download(logFileId);
          try {
            await salesforceServices.writeFile(logUri, logData);
          } catch (error: unknown) {
            const message = errorMessage(error);
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
    // An org that never answers leaves this busy for good, so name the way out.
    qp.placeholder = 'Loading logs. Press Escape to cancel.';
    qp.busy = true;
    qp.enabled = false;
    qp.show();
    return qp;
  }

  /** Dismissal cancels the work, so an org that never answers leaves nothing running behind. */
  private static whileLoading<T>(
    picker: VSCodeQuickPick<QuickPickItem>,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined> {
    const cancellation = new AbortController();
    let hidden: Disposable | undefined;
    const dismissed = new Promise<undefined>((resolve) => {
      hidden = picker.onDidHide(() => {
        cancellation.abort();
        resolve(undefined);
      });
    });

    return Promise.race([work(cancellation.signal), dismissed]).finally(() => hidden?.dispose());
  }

  private static async targetOrg(
    context: Context,
    salesforceServices: SalesforceServices,
  ): Promise<TargetOrg> {
    try {
      return await salesforceServices.getTargetOrg();
    } catch (error: unknown) {
      context.display.output(`Unable to read the default org: ${errorMessage(error)}`);
      return {};
    }
  }

  private static placeholder({ alias, username }: TargetOrg): string {
    const org = alias ?? username;
    return org ? `Select or search for a log (${org})` : 'Select or search for a log';
  }

  private static assertRetrievedLog(logId: string, logData: string): void {
    if (/^access\s*denied$/i.test(logData.trim())) {
      throw new Error(
        `Salesforce denied access to the body of Apex log ${logId}. Verify that the authenticated user can access ApexLog records and their bodies.`,
      );
    }
  }
}
