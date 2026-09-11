/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { commands, window } from 'vscode';

import type { Context } from '../Context.js';

export class WhatsNewNotification {
  static async apply(context: Context): Promise<void> {
    try {
      await WhatsNewNotification.show(context);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      context.display.output(`Unable to show the What's New notification: ${message}`);
    }
  }

  private static async show(context: Context): Promise<void> {
    const extensionInfo = context.context.extension;
    const versionNumber: string[] = extensionInfo.packageJSON.version.split(/[.-]/);
    const versionText = versionNumber.slice(0, 3).join('.');

    const changeLogViewedkey = 'update.confirmed.versions';
    const changelogViewedVersions =
      context.context.globalState.get<string[]>(changeLogViewedkey) || [];

    // Only show the whats new notification if this is a minor version or larger (not a bug fix) + if the notification for this minor has not been dismissed or viewed already.
    if (versionNumber[2] !== '0' || changelogViewedVersions.includes(versionText)) {
      return;
    }

    const extensionId = extensionInfo.id;
    const whatsNew = "See What's New";

    // Started now because the notification may never be answered, awaited last so it can
    // neither hide the notification nor drop the click.
    const recorded = context.context.globalState.update(changeLogViewedkey, [versionText]);

    const selection = await window.showInformationMessage(
      "Apex Log Analyzer has been updated. See What's New.",
      whatsNew,
    );
    if (selection === whatsNew) {
      commands.executeCommand('extension.open', extensionId, 'changelog');
    }

    await recorded;
  }
}
