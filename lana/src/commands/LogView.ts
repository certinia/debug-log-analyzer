/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { createReadStream, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, parse } from 'path';
import { Uri, commands, window as vscWindow, workspace, type WebviewPanel } from 'vscode';

import type { Context } from '../Context.js';
import { OpenFileInPackage } from '../display/OpenFileInPackage.js';
import { WebView } from '../display/WebView.js';
import { RawLogNavigation } from '../log-features/RawLogNavigation.js';
import {
  PRIVATE_SECTIONS,
  getColumnOverrides,
  getColumnViews,
  getConfig,
  getInspectorState,
  sameConfig,
  updateConfig,
  updatePrivateSection,
  type Config,
} from '../workspace/AppConfig.js';

interface WebViewLogFileRequest<T = unknown> {
  requestId: string;
  cmd: string;
  payload: T;
}

export class LogView {
  private static helpUrl = 'https://certinia.github.io/debug-log-analyzer/';
  private static currentPanel: WebviewPanel | undefined;
  private static currentLogPath: string | undefined;
  private static pendingNavigationTimestamp: number | undefined;

  static getCurrentView() {
    return LogView.currentPanel;
  }

  static getLogPath() {
    return LogView.currentLogPath;
  }

  static setPendingNavigation(timestamp: number): void {
    LogView.pendingNavigationTimestamp = timestamp;
  }

  static async createView(
    context: Context,
    beforeSendLog?: Promise<void>,
    logPath?: string,
    logData?: string,
  ): Promise<WebviewPanel> {
    const panel = WebView.apply('logFile', `Log: ${logPath ? basename(logPath) : 'Untitled'}`, [
      Uri.file(join(context.context.extensionPath, 'out')),
      Uri.file(dirname(logPath || '')),
    ]);
    this.currentPanel = panel;
    this.currentLogPath = logPath;

    const logViewerRoot = join(context.context.extensionPath, 'out');
    const index = join(logViewerRoot, 'index.html');
    const bundleUri = panel.webview.asWebviewUri(Uri.file(join(logViewerRoot, 'bundle.js')));
    const codiconUri = panel.webview.asWebviewUri(Uri.file(join(logViewerRoot, 'codicon.css')));
    const indexSrc = await this.getFile(index);
    panel.iconPath = Uri.file(join(logViewerRoot, 'certinia-icon-color.png'));
    panel.webview.html = indexSrc
      .replace(/bundle\.js/gi, bundleUri.toString(true))
      .replace(/codicon\.css/gi, codiconUri.toString(true));

    // The panel keeps its context when hidden, so it is never re-created: settings
    // edits have to be pushed to it. Only push when the resolved payload actually
    // changed — every webview subscriber re-applies it.
    let lastConfig = LogView.resolveConfig(context);
    const configListener = workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('lana')) {
        return;
      }

      const config = LogView.resolveConfig(context);
      if (!sameConfig(config, lastConfig)) {
        lastConfig = config;
        panel.webview.postMessage({ cmd: 'configChanged', payload: config });
      }
    });

    panel.onDidDispose(
      () => {
        configListener.dispose();
        this.currentPanel = undefined;
        this.currentLogPath = undefined;
      },
      undefined,
      context.context.subscriptions,
    );

    panel.webview.onDidReceiveMessage(
      async (msg: WebViewLogFileRequest) => {
        const { cmd, requestId, payload } = msg;

        switch (cmd) {
          case 'fetchLog': {
            await beforeSendLog;
            LogView.sendLog(requestId, panel, context, logPath, logData);
            break;
          }

          case 'openPath': {
            const filePath = payload as string;
            if (filePath) {
              context.display.showFile(filePath);
            }
            break;
          }

          case 'openType': {
            const symbol = payload as string;
            if (symbol) {
              OpenFileInPackage.openFileForSymbol(context, symbol);
            }
            break;
          }

          case 'openHelp': {
            commands.executeCommand('vscode.open', Uri.parse(this.helpUrl));
            break;
          }

          case 'openUrl': {
            // https only: a webview message must not be able to hand VS Code a
            // `command:` or `file:` URI to execute.
            const url = typeof payload === 'string' ? payload : '';
            if (url && Uri.parse(url).scheme === 'https') {
              commands.executeCommand('vscode.open', Uri.parse(url));
            }
            break;
          }

          case 'getConfig': {
            panel.webview.postMessage({
              requestId,
              cmd: 'getConfig',
              payload: LogView.resolveConfig(context),
            });
            break;
          }

          case 'updateConfig': {
            const { section, value } = payload as { section: string; value: unknown };
            if (section) {
              if ((PRIVATE_SECTIONS as readonly string[]).includes(section)) {
                updatePrivateSection(context.context.globalState, section, value);
              } else {
                updateConfig(section, value);
              }
            }
            break;
          }

          case 'saveFile': {
            const { fileContent, options } = payload as {
              fileContent: string;
              options: { defaultFileName?: string };
            };

            if (fileContent && options?.defaultFileName) {
              const defaultWorkspace = (workspace.workspaceFolders || [])[0];
              const defaultDir = defaultWorkspace?.uri.path || homedir();
              const destinationFile = await vscWindow.showSaveDialog({
                defaultUri: Uri.file(join(defaultDir, options.defaultFileName)),
              });

              if (destinationFile) {
                writeFile(destinationFile.fsPath, fileContent).catch((error) => {
                  const msg = error instanceof Error ? error.message : String(error);
                  vscWindow.showErrorMessage(`Unable to save file: ${msg}`);
                });
              }
            }
            break;
          }

          case 'showError': {
            const { text } = payload as { text: string };
            if (text) {
              vscWindow.showErrorMessage(text);
            }
            break;
          }

          case 'goToLogLine': {
            const { timestamp } = payload as { timestamp: number };
            if (timestamp && LogView.currentLogPath) {
              RawLogNavigation.goToLineByTimestamp(LogView.currentLogPath, timestamp);
            }
            break;
          }
        }
      },
      undefined,
      [],
    );

    return panel;
  }

  /**
   * The `lana` settings plus the private globalState sections the webview needs.
   * Shared by the initial `getConfig` reply and every `configChanged` push so the
   * two can never drift.
   */
  private static resolveConfig(context: Context): Config {
    const config = getConfig();
    const overrides = getColumnOverrides(context.context.globalState);
    config.callTree.columnOverrides = overrides['callTree.columnOverrides'] ?? {};
    config.database.soql.columnOverrides = overrides['database.soql.columnOverrides'] ?? {};
    config.database.dml.columnOverrides = overrides['database.dml.columnOverrides'] ?? {};
    config.database.sosl.columnOverrides = overrides['database.sosl.columnOverrides'] ?? {};
    const columnViews = getColumnViews(context.context.globalState);
    config.database.soql.columnView = columnViews['database.soql.columnView'] ?? 'General';
    config.database.dml.columnView = columnViews['database.dml.columnView'] ?? 'General';
    config.database.sosl.columnView = columnViews['database.sosl.columnView'] ?? 'General';
    Object.assign(config.inspector, getInspectorState(context.context.globalState));
    return config;
  }

  private static async getFile(filePath: string): Promise<string> {
    let data = '';
    return new Promise((resolve, reject) => {
      createReadStream(filePath)
        .on('error', (error) => {
          reject(error);
        })
        .on('data', (row) => {
          data += row;
        })
        .on('end', () => {
          resolve(data);
        });
    });
  }

  private static sendLog(
    requestId: string,
    panel: WebviewPanel,
    context: Context,
    logFilePath?: string,
    logData?: string,
  ) {
    if (!logData && !existsSync(logFilePath || '')) {
      context.display.showErrorMessage('Log file could not be found.', {
        modal: true,
      });
    }

    const filePath = parse(logFilePath || '');
    const navigateToTimestamp = LogView.pendingNavigationTimestamp;
    LogView.pendingNavigationTimestamp = undefined;

    panel.webview.postMessage({
      requestId,
      cmd: 'fetchLog',
      payload: {
        logName: filePath.base,
        logUri: logFilePath ? panel.webview.asWebviewUri(Uri.file(logFilePath)).toString(true) : '',
        logPath: logFilePath,
        logData: logData,
        navigateToTimestamp,
      },
    });
  }
}
