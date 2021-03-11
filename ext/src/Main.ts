/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { ExtensionContext } from "vscode";
import { Context } from "./Context";
import { Display } from "./Display";

interface InitConfig {
  debug: boolean;
}

export const appName: string = "Lana";
export let context: Context | null = null;

export function activate(
  extensionContext: ExtensionContext,
  config: InitConfig
) {
  context = new Context(
    extensionContext,
    new Display(extensionContext),
    config.debug
  );
}

export function deactivate() {
  context = null;
}
