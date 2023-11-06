/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { createReadStream, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join, parse } from 'path';
import { WebviewPanel, window as vscWindow } from 'vscode';
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

export class LogView {
  private static helpUrl = 'https://certinia.github.io/debug-log-analyzer/';

  static async createView(
    wsPath: string,
    context: Context,
    logPath: string,
    beforeSendLog?: Promise<void>
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
      '${extensionRoot}': panel.webview.asWebviewUri(Uri.file(join(logViewerRoot))).toString(),
      'bundle.js': bundleUri.toString(true), // eslint-disable-line @typescript-eslint/naming-convention
    };

    panel.iconPath = Uri.file(join(logViewerRoot, 'certinia-icon-color.png'));
    panel.webview.html = indexSrc.replace(/bundle.js|\${extensionRoot}/gi, function (matched) {
      return toReplace[matched];
    });

    panel.webview.onDidReceiveMessage(
      async (msg: WebViewLogFileRequest) => {
        const request = msg;

        switch (request.cmd) {
          case 'fetchLog': {
            await beforeSendLog;
            LogView.sendLog(panel, context, logPath);
            break;
          }

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

  private static sendLog(panel: WebviewPanel, context: Context, logFilePath: string) {
    if (!existsSync(logFilePath)) {
      context.display.showErrorMessage('Log file could not be found.', {
        modal: true,
      });
    }

    const filePath = parse(logFilePath);
    panel.webview.postMessage({
      command: 'fetchLog',
      data: {
        logName: filePath.name,
        logUri: panel.webview.asWebviewUri(Uri.file(logFilePath)).toString(true),
        logPath: logFilePath,
      },
    });
  }
}
