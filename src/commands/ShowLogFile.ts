/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Uri, window } from "vscode";
import { Context } from "../Context";
import { QuickPickWorkspace } from "../display/QuickPickWorkspace";
import * as path from "path";
import { promises as fs } from "fs";
import { LogView } from "./LogView";
import { Command } from "./Command";
import { appName } from "../Main";

export class ShowLogFile {
  static apply(context: Context): void {
    new Command("showLogFile", (uri: Uri) =>
      ShowLogFile.safeCommand(context, uri)
    ).register(context);
    context.display.output(`Registered command '${appName}: Show Log'`);
  }

  private static async safeCommand(context: Context, uri: Uri): Promise<void> {
    try {
      return ShowLogFile.command(context, uri);
    } catch (err) {
      context.display.showErrorMessage(`Error showing logfile: ${err.message}`);
      return Promise.resolve();
    }
  }

  private static async command(context: Context, uri: Uri): Promise<void> {
    let filePath;

    if (uri) filePath = uri.fsPath;
    else if (window.activeTextEditor)
      filePath = window.activeTextEditor.document.uri.fsPath;

    if (filePath) {
      const ws = await QuickPickWorkspace.pickOrReturn(context);
      const name = path.parse(filePath).name;
      const view = await LogView.createView(ws, context, name);
      const fileContents = (await fs.readFile(filePath)).toString("utf8");
      await LogView.appendView(view, context, name, filePath, fileContents);
    } else {
      context.display.showErrorMessage(
        "No file selected to display log analysis"
      );
      throw new Error("No file selected to display log analysis");
    }
  }
}
