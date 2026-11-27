/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { window } from 'vscode';

import { appName } from '../AppSettings.js';
import { ApexLogCache, type CacheSize } from '../cache/ApexLogCache.js';
import type { Context } from '../Context.js';
import { megabytes, plural } from '../display/format.js';
import { Command } from './Command.js';

const DELETE = 'Delete';

export class ClearApexLogCache {
  static apply(context: Context): void {
    new Command(
      'clearApexLogCache',
      'Log: Clear Apex Log Cache',
      context,
      'Error clearing the Apex log cache',
      () => ClearApexLogCache.command(context),
    ).register();
    context.display.output(`Registered command '${appName}: Clear Apex Log Cache'`);
  }

  /** Asks before deleting; resolves true when the user agreed. */
  static async confirm({ count, bytes }: CacheSize, scope: string): Promise<boolean> {
    const answer = await window.showWarningMessage(
      `Delete ${plural(count, 'cached Apex log')} (${megabytes(bytes)}) ${scope}? Logs you opened in .sfdx are kept.`,
      { modal: true },
      DELETE,
    );
    return answer === DELETE;
  }

  private static async command(context: Context): Promise<void> {
    const cache = ApexLogCache.for(context);
    const size = await cache.size();
    if (size.count === 0) {
      await window.showInformationMessage('The Apex log cache is empty.');
      return;
    }
    if (await ClearApexLogCache.confirm(size, 'for this workspace')) {
      await cache.clearAll();
    }
  }
}
