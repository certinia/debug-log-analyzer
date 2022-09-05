/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { ExtensionContext } from 'vscode';
import { Context } from './Context';
import { Display } from './Display';

export const appName = 'Lana';
export let context: Context | null = null;

export function activate(extensionContext: ExtensionContext) {
  context = new Context(extensionContext, new Display());
}

export function deactivate() {
  context = null;
}
