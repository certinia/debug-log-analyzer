/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { createReadStream } from 'fs';
import { writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { type WebviewPanel, window as vscWindow } from 'vscode';
import { Uri, commands, workspace } from 'vscode';

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

export interface FetchLogCallBack {
  (panel: WebviewPanel): void;
}

export class LogView {
  private static helpUrl = 'https://certinia.github.io/debug-log-analyzer/';

  static async createView(
    wsPath: string,
    context: Context,
    logName: string,
    logPath: string,
    callback: FetchLogCallBack
  ): Promise<WebviewPanel> {
    const panel = WebView.apply('logFile', 'Log: ' + basename(logPath), [
      Uri.file(join(context.context.extensionPath, 'out')),
      Uri.file(dirname(logPath)),
    ]);

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

    panel.webview.onDidReceiveMessage(
      (msg: WebViewLogFileRequest) => {
        const request = msg;

        switch (request.cmd) {
          case 'fetchLog': {
            callback(panel);
            break;
          }

          case 'openPath':
            if (request.path) {
              context.display.showFile(request.path);
            }
            break;

          case 'openType': {
            if (request.typeName) {
              const [className, lineNumber] = request.typeName.split('-');
              let line;
              if (lineNumber) {
                line = parseInt(lineNumber);
              }
              OpenFileInPackage.openFileForSymbol(wsPath, context, className || '', line);
            }
            break;
          }

          case 'openHelp': {
            commands.executeCommand('vscode.open', Uri.parse(this.helpUrl));
            break;
          }

          case 'getConfig': {
            panel.webview.postMessage({
              command: 'getConfig',
              data: workspace.getConfiguration('lana'),
            });
            break;
          }

          case 'saveFile': {
            if (request.text && request.options?.defaultUri) {
              const defaultWorkspace = (workspace.workspaceFolders || [])[0];
              const defaultDir = defaultWorkspace?.uri.path || homedir();
              vscWindow
                .showSaveDialog({
                  defaultUri: Uri.file(join(defaultDir, request.options.defaultUri)),
                })
                .then((fileInfos) => {
                  if (fileInfos && request.text) {
                    writeFile(fileInfos.path, request.text).catch((error) => {
                      const msg = error instanceof Error ? error.message : String(error);
                      vscWindow.showErrorMessage(`Unable to save file: ${msg}`);
                    });
                  }
                });
            }
            break;
          }

          case 'showError': {
            if (request.text) {
              vscWindow.showErrorMessage(request.text);
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
}
