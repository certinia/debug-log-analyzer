/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import * as fs from 'fs';
import { basename, dirname, join } from 'path';
import { Uri, WebviewPanel, workspace } from 'vscode';
import * as vscode from 'vscode';

import { Context } from '../Context';
import { OpenFileInPackage } from '../display/OpenFileInPackage';
import { WebView } from '../display/WebView';

interface WebViewLogFileRequest {
  cmd: string;
  text: string | undefined;
  typeName: string | undefined;
  path: string | undefined;
  options?: Record<string, never>;
}

export class LogFileException extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = 'LogFileException';
  }
}

export class LogView {
  private static helpUrl = 'https://certinia.github.io/debug-log-analyzer/';

  static async createView(
    wsPath: string,
    context: Context,
    logPath: string
  ): Promise<WebviewPanel> {
    const panel = WebView.apply('logFile', 'Log: ' + basename(logPath), [
      vscode.Uri.file(join(context.context.extensionPath, 'out')),
      vscode.Uri.file(dirname(logPath)),
    ]);
    panel.webview.onDidReceiveMessage(
      (msg: WebViewLogFileRequest) => {
        const request = msg;

        switch (request.cmd) {
          case 'openPath':
            if (request.path) {
              context.display.showFile(request.path);
            }
            break;

          case 'openType': {
            if (request.typeName) {
              const parts = request.typeName.split('-');
              let line;
              if (parts.length > 1) {
                line = parseInt(parts[1]);
              }
              OpenFileInPackage.openFileForSymbol(wsPath, context, parts[0], line);
            }
            break;
          }

          case 'openHelp': {
            vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(this.helpUrl));
            break;
          }

          case 'getConfig': {
            panel.webview.postMessage({
              command: 'getConfig',
              data: vscode.workspace.getConfiguration('lana'),
            });
            break;
          }

          case 'saveFile': {
            if (request.text && request.options?.defaultUri) {
              const defaultDir = (workspace.workspaceFolders || [])[0].uri.path;
              vscode.window
                .showSaveDialog({
                  defaultUri: Uri.file(join(defaultDir, request.options.defaultUri)),
                })
                .then((fileInfos) => {
                  if (fileInfos && request.text) {
                    fs.promises.writeFile(fileInfos.path, request.text).catch((error) => {
                      const msg = error instanceof Error ? error.message : String(error);
                      vscode.window.showErrorMessage(`Unable to save file: ${msg}`);
                    });
                  }
                });
            }
            break;
          }

          case 'showError': {
            if (request.text) {
              vscode.window.showErrorMessage(request.text);
            }
            break;
          }
        }
      },
      undefined,
      []
    );

    return panel;
  }

  static async appendView(
    view: WebviewPanel,
    context: Context,
    logName: string,
    logPath: string
  ): Promise<WebviewPanel> {
    view.webview.html = await LogView.getViewContent(view, context, logName, logPath);
    return view;
  }

  private static async getViewContent(
    view: WebviewPanel,
    context: Context,
    logName: string,
    logPath: string
  ): Promise<string> {
    const logViewerRoot = join(context.context.extensionPath, 'out');
    const index = join(logViewerRoot, 'index.html');
    const bundleUri = view.webview.asWebviewUri(vscode.Uri.file(join(logViewerRoot, 'bundle.js')));
    const logPathUri = view.webview.asWebviewUri(vscode.Uri.file(logPath));
    const toReplace: { [key: string]: string } = {
      '@@name': logName, // eslint-disable-line @typescript-eslint/naming-convention
      '@@path': logPath, // eslint-disable-line @typescript-eslint/naming-convention
      'bundle.js': bundleUri.toString(true), // eslint-disable-line @typescript-eslint/naming-convention
      'sample.log': logPathUri.toString(true), // eslint-disable-line @typescript-eslint/naming-convention
    };

    const indexSrc = await this.getFile(index);
    return indexSrc.replace(/@@name|@@path|bundle.js|sample.log/gi, function (matched) {
      return toReplace[matched];
    });
  }

  private static async getFile(filePath: string): Promise<string> {
    let data = '';
    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
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
}
