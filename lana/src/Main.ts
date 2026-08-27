/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import type { ExtensionContext } from 'vscode';

import { Context } from './Context.js';
import { Display } from './display/Display.js';

export let context: Context | null = null;

export function activate(extensionContext: ExtensionContext) {
  context = new Context(extensionContext, new Display());
}

export async function deactivate() {
  context = null;
  const { disposeServices } = await import('./services/servicesRuntime.js');
  await disposeServices();
}
