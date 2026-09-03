/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { TabInputText, TabInputTextDiff, window, type Uri } from 'vscode';

/**
 * How `uri` is shown in the tab model.
 *
 * A URI can back a TextDocument nobody is reading: either side of a diff, a
 * notebook cell, a custom editor's backing document. Those all fire
 * onDidOpenTextDocument and appear in workspace.textDocuments, so work that
 * costs a full read and parse has to ask the tab model instead.
 *
 * Deliberately not a scheme check: a scheme names the filesystem provider, not
 * how the resource is shown, so a memfs: or vscode-vfs: log in a normal tab is
 * a normal open. `unknown` covers both "listed in no tab" and tab kinds this
 * build has never seen, so each caller picks its own default rather than
 * inheriting one.
 */
export type TabPresence = 'text' | 'diffOnly' | 'unknown';

export function tabPresence(uri: Uri): TabPresence {
  const key = uri.toString();
  let presence: TabPresence = 'unknown';

  for (const group of window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof TabInputText && input.uri.toString() === key) {
        return 'text';
      }
      if (
        input instanceof TabInputTextDiff &&
        (input.original.toString() === key || input.modified.toString() === key)
      ) {
        presence = 'diffOnly';
      }
    }
  }

  return presence;
}

/** True only when `uri` is open as a plain text tab; `unknown` counts as no. */
export function isOpenAsTextTab(uri: Uri): boolean {
  return tabPresence(uri) === 'text';
}
