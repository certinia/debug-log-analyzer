/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import type { ExtensionContext } from 'vscode';

import { Context } from './Context.js';
import { Display } from './display/Display.js';
import { disposeServices, initServices } from './services/servicesRuntime.js';

export let context: Context | null = null;

export async function activate(extensionContext: ExtensionContext) {
  console.log('[LANA] Activation starting...');

  // Resolve the salesforcedx-vscode-services API (desktop + web) before wiring
  // up commands, since org retrieval and filesystem access route through it.
  console.log('[LANA] Initializing services...');
  await initServices();
  console.log('[LANA] Services initialized');

  console.log('[LANA] Creating context...');
  context = new Context(extensionContext, new Display());
  console.log('[LANA] Activation complete');
}

export async function deactivate() {
  context = null;
  await disposeServices();
}
