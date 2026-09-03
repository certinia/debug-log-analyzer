/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { TabInputText, TabInputTextDiff, window, type Uri } from 'vscode';

/**
 * True when `uri` is open as a plain text tab.
 *
 * A URI can back a TextDocument the user is not reading: either side of a diff,
 * a notebook cell, a custom editor's backing document. Those fire
 * onDidOpenTextDocument and appear in workspace.textDocuments like any other
 * open, so work that costs a full read and parse must be gated on this —
 * diffing a log should not parse it.
 *
 * Deliberately not a scheme check: a scheme names the filesystem provider, not
 * how the resource is shown, and a memfs: or vscode-vfs: log in a normal tab is
 * a normal open. Allow-list rather than a diff deny-list so tab kinds this build
 * has never seen count as "not viewing", the safe direction for a gate.
 */
export function isOpenAsTextTab(uri: Uri): boolean {
  const key = uri.toString();
  for (const group of window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof TabInputText && tab.input.uri.toString() === key) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True only when `uri` is shown as a diff side and nowhere else.
 *
 * The weaker form of {@link isOpenAsTextTab}, for providers VS Code asks once
 * and never asks again. A symbol request can arrive before the tab model lists
 * the tab, and DocumentSymbolProvider has no change event to recover with, so
 * the strict check would leave the Outline empty for the life of the editor.
 * Answering "not a diff" while the model catches up costs at most one parse of
 * a log the user did open.
 */
export function isShownOnlyAsDiff(uri: Uri): boolean {
  const key = uri.toString();
  let seenAsDiff = false;

  for (const group of window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof TabInputText && input.uri.toString() === key) {
        return false;
      }
      if (
        input instanceof TabInputTextDiff &&
        (input.original.toString() === key || input.modified.toString() === key)
      ) {
        seenAsDiff = true;
      }
    }
  }

  return seenAsDiff;
}
