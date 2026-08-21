/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import type { ExtensionContext } from 'vscode';

import { Context } from './Context.js';
import { Display } from './display/Display.js';
import { disposeServices, initServices } from './services/servicesRuntime.js';

export let context: Context | null = null;

export async function activate(extensionContext: ExtensionContext) {
  await initServices();
  context = new Context(extensionContext, new Display());
}

export async function deactivate() {
  context = null;
  await disposeServices();
}
