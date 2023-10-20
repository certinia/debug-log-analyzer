/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { commands, window } from 'vscode';

import { Context } from '../Context.js';

export class WhatsNewNotification {
  static async apply(context: Context): Promise<void> {
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
    window
      .showInformationMessage("Apex Log Analyzer has been updated. See What's New.", whatsNew)
      .then((selection) => {
        if (selection === whatsNew) {
          commands.executeCommand('extension.open', extensionId, 'changelog');
        }
      });

    // if whats new was clicked, dismissed or timed out we do not want to show the notification again so register this version in the change log viewed state.
    context.context.globalState.update(changeLogViewedkey, [versionText]);
  }
}
