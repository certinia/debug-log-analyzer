/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Uri, window } from "vscode";
import { Context } from "../Context";
import { QuickPickWorkspace } from "../display/QuickPickWorkspace";
import * as path from "path";
import { LogView } from "./LogView";
import { Command } from "./Command";
import { appName } from "../AppSettings";

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
    } catch (err: any) {
      context.display.showErrorMessage(`Error showing logfile: ${err.message}`);
      return Promise.resolve();
    }
  }

  private static async command(context: Context, uri: Uri): Promise<void> {
    const filePath = uri?.fsPath || window?.activeTextEditor?.document.fileName;

    if (filePath) {
      const name = path.parse(filePath).name;
      const ws = await QuickPickWorkspace.pickOrReturn(context);

      const view = await LogView.createView(ws, context, filePath);
      LogView.appendView(view, context, name, filePath);
    } else {
      context.display.showErrorMessage(
        "No file selected to display log analysis"
      );
      throw new Error("No file selected to display log analysis");
    }
  }
}
