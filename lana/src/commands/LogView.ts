/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Uri, commands, window as vscWindow, workspace, type WebviewPanel } from 'vscode';
import { Utils } from 'vscode-uri';

import type { Context } from '../Context.js';
import { OpenFileInPackage } from '../display/OpenFileInPackage.js';
import { WebView } from '../display/WebView.js';
import { RawLogNavigation } from '../log-features/RawLogNavigation.js';
import { fileOrFolderExists, readFile, writeFile } from '../services/salesforceServices.js';
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
  requestId?: string;
  cmd: string;
  payload?: T;
}

export class LogView {
  private static helpUrl = 'https://certinia.github.io/debug-log-analyzer/';
  private static currentPanel: WebviewPanel | undefined;
  private static currentLogUri: Uri | undefined;
  private static pendingNavigationTimestamp: number | undefined;

  static getCurrentView() {
    return LogView.currentPanel;
  }

  /** @returns URI string for the current log (works on desktop + web). */
  static getLogPath(): string | undefined {
    return LogView.currentLogUri?.toString();
  }

  /** @returns The current log URI object. */
  static getLogUri(): Uri | undefined {
    return LogView.currentLogUri;
  }

  static setPendingNavigation(timestamp: number): void {
    LogView.pendingNavigationTimestamp = timestamp;
  }

  static async createView(
    context: Context,
    beforeSendLog?: Promise<void>,
    logUri?: Uri,
    logData?: string,
  ): Promise<WebviewPanel> {
    const logName = logUri ? Utils.basename(logUri) : 'Untitled';
    const logDir = logUri ? Utils.dirname(logUri) : context.context.extensionUri;

    const panel = WebView.apply('logFile', `Log: ${logName}`, [
      Utils.joinPath(context.context.extensionUri, 'dist'),
      logDir,
    ]);
    this.currentPanel = panel;
    this.currentLogUri = logUri;

    const logViewerRoot = Utils.joinPath(context.context.extensionUri, 'dist');
    const indexUri = Utils.joinPath(logViewerRoot, 'index.html');
    const bundleUri = panel.webview.asWebviewUri(Utils.joinPath(logViewerRoot, 'bundle.js'));
    const codiconUri = panel.webview.asWebviewUri(Utils.joinPath(logViewerRoot, 'codicon.css'));
    const indexSrc = await this.getFile(indexUri);
    panel.iconPath = Utils.joinPath(logViewerRoot, 'salesforce-icon.png');
    panel.webview.html = indexSrc
      .replace(/vscode-webview-resource:/gi, panel.webview.cspSource)
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
        this.currentLogUri = undefined;
      },
      undefined,
      context.context.subscriptions,
    );

    panel.webview.onDidReceiveMessage(
      async (msg: WebViewLogFileRequest) => {
        if (!isWebViewLogFileRequest(msg)) {
          return;
        }

        const { cmd, requestId, payload } = msg;

        switch (cmd) {
          case 'fetchLog': {
            if (requestId) {
              await beforeSendLog;
              LogView.sendLog(requestId, panel, context, logUri, logData);
            }
            break;
          }

          case 'openPath': {
            if (logUri) {
              context.display.showFile(logUri.toString());
            }
            break;
          }

          case 'openType': {
            if (typeof payload === 'string' && payload) {
              const symbol = payload;
              await OpenFileInPackage.openFileForSymbol(context, symbol);
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
            if (isConfigUpdate(payload)) {
              const { section, value } = payload;
              if ((PRIVATE_SECTIONS as readonly string[]).includes(section)) {
                updatePrivateSection(context.context.globalState, section, value);
              } else {
                updateConfig(section, value);
              }
            }
            break;
          }

          case 'saveFile': {
            if (isSaveFileRequest(payload)) {
              const { fileContent, options } = payload;
              const defaultWorkspace = (workspace.workspaceFolders || [])[0];
              // On web (memfs/vscode-vfs), workspace folder URI is the default save dir.
              // On desktop, workspace.workspaceFolders[0].uri is file:// — works directly.
              const defaultDir = defaultWorkspace?.uri || context.context.extensionUri;
              const destinationFile = await vscWindow.showSaveDialog({
                defaultUri: Utils.joinPath(defaultDir, options.defaultFileName),
              });

              if (destinationFile) {
                writeFile(destinationFile, fileContent).then(undefined, (error) => {
                  const msg = error instanceof Error ? error.message : String(error);
                  vscWindow.showErrorMessage(`Unable to save file: ${msg}`);
                });
              }
            }
            break;
          }

          case 'showError': {
            if (isTextPayload(payload)) {
              vscWindow.showErrorMessage(payload.text);
            }
            break;
          }

          case 'goToLogLine': {
            if (isTimestampPayload(payload) && logUri) {
              RawLogNavigation.goToLineByTimestamp(logUri, payload.timestamp);
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

  private static async getFile(fileUri: Uri): Promise<string> {
    return readFile(fileUri);
  }

  private static async sendLog(
    requestId: string,
    panel: WebviewPanel,
    context: Context,
    logUri?: Uri,
    logData?: string,
  ) {
    // If no inline data and the URI is provided, check existence asynchronously.
    if (!logData && logUri) {
      const exists = await fileOrFolderExists(logUri);
      if (!exists) {
        context.display.showErrorMessage('Log file could not be found.', {
          modal: true,
        });
        return;
      }
    }

    const logName = logUri ? Utils.basename(logUri) : '';
    const navigateToTimestamp = LogView.pendingNavigationTimestamp;
    LogView.pendingNavigationTimestamp = undefined;

    panel.webview.postMessage({
      requestId,
      cmd: 'fetchLog',
      payload: {
        logName,
        logUri: logUri ? panel.webview.asWebviewUri(logUri).toString(true) : '',
        logPath: logUri?.toString(), // URI string for reopen target (desktop + web)
        logData: logData,
        navigateToTimestamp,
      },
    });
  }
}

function isWebViewLogFileRequest(value: unknown): value is WebViewLogFileRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const message = value as Record<string, unknown>;
  return (
    typeof message.cmd === 'string' &&
    (message.requestId === undefined || typeof message.requestId === 'string')
  );
}

function isConfigUpdate(value: unknown): value is { section: string; value: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const section = (value as Record<string, unknown>).section;
  return typeof section === 'string' && section.trim().length > 0;
}

function isSaveFileRequest(
  value: unknown,
): value is { fileContent: string; options: { defaultFileName: string } } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.fileContent !== 'string' || !payload.fileContent) {
    return false;
  }

  const options = payload.options;
  return (
    typeof options === 'object' &&
    options !== null &&
    !Array.isArray(options) &&
    typeof (options as Record<string, unknown>).defaultFileName === 'string' &&
    Boolean((options as Record<string, unknown>).defaultFileName)
  );
}

function isTextPayload(value: unknown): value is { text: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).text === 'string' &&
    Boolean((value as Record<string, unknown>).text)
  );
}

function isTimestampPayload(value: unknown): value is { timestamp: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).timestamp === 'number' &&
    Number.isFinite((value as Record<string, unknown>).timestamp)
  );
}
