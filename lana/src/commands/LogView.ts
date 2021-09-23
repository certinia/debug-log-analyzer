/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { WebviewPanel } from "vscode";
import { Context } from "../Context";
import { OpenFileInPackage } from "../display/OpenFileInPackage";
import { WebView } from "../display/WebView";
import * as path from "path";
import { promises as fs } from "fs";
import * as vscode from "vscode";

interface WebViewLogFileRequest {
  text: string | undefined;
  typeName: string | undefined;
  path: string | undefined;
}

export class LogFileException extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = "LogFileException";
  }
}

export class LogView {
  static async createView(
    wsPath: string,
    context: Context,
    logName: string
  ): Promise<WebviewPanel> {
    const panel = WebView.apply("logFile", "Log: " + logName, [
      vscode.Uri.file(path.join(context.context.extensionPath, "out")),
    ]);
    panel.webview.onDidReceiveMessage(
      (msg: any) => {
        const request = msg as WebViewLogFileRequest;

        if (request.typeName) {
          const parts = request.typeName.split("-");
          let line;
          if (parts.length > 1) {
            line = parseInt(parts[1]);
          }
          OpenFileInPackage.openFileForSymbol(wsPath, context, parts[0], line);
        } else if (request.path) {
          context.display.showFile(request.path);
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
    logPath: string,
    logContents: string
  ): Promise<WebviewPanel> {
    view.webview.html = await LogView.getViewContent(
      view,
      context,
      logName,
      logPath,
      logContents
    );
    return view;
  }

  private static async getViewContent(
    view: WebviewPanel,
    context: Context,
    logName: string,
    logPath: string,
    logContents: string
  ): Promise<string> {
    const namespaces = context.namespaces;
    const logViewerRoot = path.join(context.context.extensionPath, "out");
    const index = path.join(logViewerRoot, "index.html");
    const bundleUri = view.webview.asWebviewUri(
      vscode.Uri.file(path.join(logViewerRoot, "bundle.js"))
    );

    const indexSrc = await fs.readFile(index, "utf-8");
    const toReplace: { [key: string]: string } = {
      "@@logTxt": logContents,
      "@@name": logName,
      "@@path": logPath,
      "@@ns": namespaces.join(","),
      "bundle.js": bundleUri.toString(true),
    };

    return indexSrc.replace(
      /@@logTxt|@@name|@@path|@@ns|@@bundle/gi,
      function (matched) {
        return toReplace[matched];
      }
    );
  }
}
