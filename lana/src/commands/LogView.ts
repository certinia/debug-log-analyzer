/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { Uri, commands, window as vscWindow, workspace, type WebviewPanel } from 'vscode';
import { Utils } from 'vscode-uri';

import type { Context } from '../Context.js';
import { OpenFileInPackage } from '../display/OpenFileInPackage.js';
import { WebView } from '../display/WebView.js';
import { RawLogNavigation } from '../log-features/RawLogNavigation.js';
import { fileOrFolderExists, readFileText, writeFileText } from '../fs/workspaceFs.js';
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
  private static currentLogUri: Uri | undefined;
  private static pendingNavigationTimestamp: number | undefined;

  static getCurrentView() {
    return LogView.currentPanel;
  }

  static getLogPath() {
    return LogView.currentLogUri ? getLogDisplayPath(LogView.currentLogUri) : undefined;
  }

  static getLogUri(): Uri | undefined {
    return LogView.currentLogUri;
  }

  static setPendingNavigation(timestamp: number): void {
    LogView.pendingNavigationTimestamp = timestamp;
  }

  static async createView(
    context: Context,
    beforeSendLog?: Promise<string | void>,
    logUri?: Uri,
    logData?: string,
  ): Promise<WebviewPanel> {
    const logName = logUri ? Utils.basename(logUri) : 'Untitled';
    const logDir = logUri ? Utils.dirname(logUri) : context.context.extensionUri;
    const panel = WebView.apply('logFile', `Log: ${logName}`, [
      Utils.joinPath(context.context.extensionUri, 'out'),
      logDir,
    ]);
    this.currentPanel = panel;
    this.currentLogUri = logUri;

    const logViewerRoot = Utils.joinPath(context.context.extensionUri, 'out');
    const index = Utils.joinPath(logViewerRoot, 'index.html');
    const bundleUri = panel.webview.asWebviewUri(Utils.joinPath(logViewerRoot, 'bundle.js'));
    const codiconUri = panel.webview.asWebviewUri(Utils.joinPath(logViewerRoot, 'codicon.css'));
    const indexSrc = await this.getFile(index);
    panel.iconPath = Utils.joinPath(logViewerRoot, 'certinia-icon-color.png');
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
            if (!requestId) {
              break;
            }
            try {
              // A retrieve that resolves to a body could not be cached, so send it inline.
              const retrievedLog = await beforeSendLog;
              await LogView.sendLog(requestId, panel, context, logUri, retrievedLog || logData);
            } catch (err: unknown) {
              const errorMessage = err instanceof Error ? err.message : String(err);
              context.display.showErrorMessage(`Error loading logfile: ${errorMessage}`);
            }
            break;
          }

          case 'openPath': {
            if (logUri) {
              context.display.showFile(logUri);
            }
            break;
          }

          case 'openType': {
            if (typeof payload === 'string' && payload) {
              await OpenFileInPackage.openFileForSymbol(context, payload);
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
              const defaultDir = defaultWorkspace?.uri ?? context.context.extensionUri;
              const destinationFile = await vscWindow.showSaveDialog({
                defaultUri: Utils.joinPath(defaultDir, options.defaultFileName),
              });

              if (destinationFile) {
                writeFileText(destinationFile, fileContent).catch((error) => {
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
              await RawLogNavigation.goToLineByTimestamp(logUri, payload.timestamp);
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
    return readFileText(fileUri);
  }

  private static async sendLog(
    requestId: string,
    panel: WebviewPanel,
    context: Context,
    logUri?: Uri,
    logData?: string,
  ) {
    // Caching can fail, so only advertise a URI the webview and navigation can read.
    const cachedUri = logUri && (await fileOrFolderExists(logUri)) ? logUri : undefined;
    if (!cachedUri) {
      LogView.currentLogUri = undefined;
      if (!logData) {
        context.display.showErrorMessage('Log file could not be found.', {
          modal: true,
        });
        return;
      }
    }

    const navigateToTimestamp = LogView.pendingNavigationTimestamp;
    LogView.pendingNavigationTimestamp = undefined;

    panel.webview.postMessage({
      requestId,
      cmd: 'fetchLog',
      payload: {
        logName: logUri ? Utils.basename(logUri) : '',
        logUri: cachedUri ? panel.webview.asWebviewUri(cachedUri).toString(true) : '',
        logPath: cachedUri ? getLogDisplayPath(cachedUri) : undefined,
        logData: logData,
        navigateToTimestamp,
      },
    });
  }
}

function getLogDisplayPath(logUri: Uri): string {
  return (
    workspace.asRelativePath(logUri, true) ||
    (logUri.scheme === 'file' ? logUri.fsPath : logUri.path)
  );
}

function isWebViewLogFileRequest(value: unknown): value is WebViewLogFileRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).cmd === 'string' &&
    ((value as Record<string, unknown>).requestId === undefined ||
      typeof (value as Record<string, unknown>).requestId === 'string')
  );
}

function isConfigUpdate(value: unknown): value is { section: string; value: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).section === 'string' &&
    Boolean((value as Record<string, unknown>).section)
  );
}

function isSaveFileRequest(
  value: unknown,
): value is { fileContent: string; options: { defaultFileName: string } } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const options = payload.options;
  return (
    typeof payload.fileContent === 'string' &&
    Boolean(payload.fileContent) &&
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
