/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  TabInputText,
  commands,
  languages,
  window,
  workspace,
  type TextDocument,
  type Uri,
} from 'vscode';
import { Utils } from 'vscode-uri';

import type { Context } from '../Context.js';

export const APEXLOG_HEADER = /^(\d\d\.\d.+?)?APEX_CODE,\w.+$/;
const EXECUTION_STARTED = /^\d{2}:\d{2}:\d{2}\.\d{1,} \(\d+\)\|EXECUTION_STARTED$/;
const USER_INFO = /^\d{2}:\d{2}:\d{2}\.\d{1,} \(\d+\)\|USER_INFO\|/;
const DETECT_EXTENSIONS = new Set(['.log', '.txt']);
const MAX_LINES_TO_CHECK = 100;

export function isApexLogContent(doc: TextDocument): boolean {
  if (doc.lineCount === 0) {
    return false;
  }

  const linesToCheck = Math.min(MAX_LINES_TO_CHECK, doc.lineCount);
  for (let i = 0; i < linesToCheck; i++) {
    const text = doc.lineAt(i).text;
    if (APEXLOG_HEADER.test(text) || EXECUTION_STARTED.test(text) || USER_INFO.test(text)) {
      return true;
    }
  }

  return false;
}

function hasDetectExtension(uri: Uri): boolean {
  return DETECT_EXTENSIONS.has(Utils.extname(uri).toLowerCase());
}

function getActiveTabUri(): Uri | undefined {
  const activeTab = window.tabGroups.activeTabGroup.activeTab;
  if (activeTab?.input instanceof TabInputText) {
    return activeTab.input.uri;
  }
  return undefined;
}

function updateContextKey(): void {
  const editor = window.activeTextEditor;
  if (editor) {
    const doc = editor.document;
    const detected = hasDetectExtension(doc.uri) && isApexLogContent(doc);
    commands.executeCommand('setContext', 'lana.isApexLog', detected);
    return;
  }

  // No text document, so the only way here is a file VS Code refused to open as one.
  // Sniffing it means pulling the whole file through workspace.fs, which has no ranged
  // read: a full read and allocation on every tab event, over an RPC in the web host.
  // Trust the extension instead and accept offering the command on a large non-Apex file.
  const tabUri = getActiveTabUri();
  commands.executeCommand('setContext', 'lana.isApexLog', !!tabUri && hasDetectExtension(tabUri));
}

export class ApexLogLanguageDetector {
  static apply(context: Context): void {
    for (const doc of workspace.textDocuments) {
      detectAndSetLanguage(doc);
    }

    context.context.subscriptions.push(
      workspace.onDidOpenTextDocument((doc) => {
        detectAndSetLanguage(doc);
      }),
    );

    // Update context key when the active editor or tab changes
    context.context.subscriptions.push(
      window.onDidChangeActiveTextEditor(() => {
        updateContextKey();
      }),
    );

    context.context.subscriptions.push(
      window.tabGroups.onDidChangeTabs(() => {
        updateContextKey();
      }),
    );

    // Set initial context
    updateContextKey();
  }
}

function detectAndSetLanguage(doc: TextDocument): void {
  if (doc.languageId === 'apexlog') {
    return;
  }

  if (!hasDetectExtension(doc.uri)) {
    return;
  }

  if (isApexLogContent(doc)) {
    languages.setTextDocumentLanguage(doc, 'apexlog');
  }
}
