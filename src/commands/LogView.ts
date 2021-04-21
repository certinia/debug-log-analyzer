/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { WebviewPanel } from "vscode";
import { Context } from "../Context";
import { OpenFileInPackage } from "../display/OpenFileInPackage";
import { WebView } from "../display/WebView";
import * as path from "path";
import { promises as fs } from "fs";

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
    const panel = WebView.apply("logFile", "Log: " + logName, []);
    panel.webview.onDidReceiveMessage(
      (msg: any) => {
        const request = msg as WebViewLogFileRequest;

        if (request.typeName) {
          const parts = request.typeName.split("-");
          let line;
          if (parts.length > 1) line = parseInt(parts[1]);
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
      context,
      logName,
      logPath,
      logContents
    );
    return view;
  }

  private static async getViewContent(
    context: Context,
    logName: string,
    logPath: string,
    logContents: string
  ): Promise<string> {
    const namespaces = context.namespaces;
    const logViewerRoot = path.join(
      context.context.extensionPath,
      "log-viewer"
    );
    const index = path.join(logViewerRoot, "index.html");
    const bundle = path.join(logViewerRoot, "dist", "bundle.js");
    const indexSrc = (await fs.readFile(index)).toString("utf8");
    const bundleSrc = (await fs.readFile(bundle)).toString("utf8");

    const htmlWithLog = await LogView.insertAtToken(
      indexSrc,
      "@@logTxt",
      logContents
    );
    const htmlWithLogName = await LogView.insertAtToken(
      htmlWithLog,
      "@@name",
      logName
    );
    const htmlWithLogPath = await LogView.insertAtToken(
      htmlWithLogName,
      "@@path",
      logPath
    );
    const htmlWithNS = await LogView.insertAtToken(
      htmlWithLogPath,
      "@@ns",
      namespaces.join(",")
    );
    const htmlWithBundle = await LogView.insertAtToken(
      htmlWithNS,
      "@@bundle",
      bundleSrc
    );
    return htmlWithBundle;
  }

  private static async insertAtToken(
    str: string,
    token: string,
    insert: string
  ): Promise<string> {
    if (str.indexOf(token) > -1) {
      const splits = str.split(token);
      return splits[0] + insert + splits[1];
    }
    return str;
  }
}
