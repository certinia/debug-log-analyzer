/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { WebviewPanel } from 'vscode';
import { Context } from '../Context';
import { OpenFileInPackage } from '../display/OpenFileInPackage';
import { WebView } from '../display/WebView';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

interface WebViewLogFileRequest {
  cmd: string;
  text: string | undefined;
  typeName: string | undefined;
  path: string | undefined;
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
    const panel = WebView.apply('logFile', 'Log: ' + path.basename(logPath), [
      vscode.Uri.file(path.join(context.context.extensionPath, 'out')),
      vscode.Uri.file(path.dirname(logPath)),
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
    const logViewerRoot = path.join(context.context.extensionPath, 'out');
    const index = path.join(logViewerRoot, 'index.html');
    const bundleUri = view.webview.asWebviewUri(
      vscode.Uri.file(path.join(logViewerRoot, 'bundle.js'))
    );
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
