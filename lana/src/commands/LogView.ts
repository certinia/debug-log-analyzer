/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { createReadStream, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, parse } from 'path';
import { Uri, commands, window as vscWindow, workspace, type WebviewPanel } from 'vscode';

import { Context } from '../Context.js';
import { OpenFileInPackage } from '../display/OpenFileInPackage.js';
import { WebView } from '../display/WebView.js';
import { RawLogNavigation } from '../log-features/RawLogNavigation.js';
import { getConfig } from '../workspace/AppConfig.js';

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
    const indexSrc = await this.getFile(index);
    const toReplace: { [key: string]: string } = {
      '${extensionRoot}': panel.webview.asWebviewUri(Uri.file(join(logViewerRoot))).toString(), // eslint-disable-line @typescript-eslint/naming-convention
      'bundle.js': bundleUri.toString(true), // eslint-disable-line @typescript-eslint/naming-convention
    };

    panel.iconPath = Uri.file(join(logViewerRoot, 'certinia-icon-color.png'));
    panel.webview.html = indexSrc.replace(/bundle.js|\${extensionRoot}/gi, function (matched) {
      return toReplace[matched] || '';
    });

    panel.onDidDispose(
      () => {
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

          case 'getConfig': {
            panel.webview.postMessage({
              requestId,
              cmd: 'getConfig',
              payload: getConfig(),
            });
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
