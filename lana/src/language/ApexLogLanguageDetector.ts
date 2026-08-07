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
import { readFile } from '../services/salesforceServices.js';

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

async function isApexLogFile(uri: Uri): Promise<boolean> {
  try {
    const fullText = await readFile(uri);
    // Read first 4096 chars (mirroring the old Buffer-based sniff)
    const text = fullText.slice(0, 4096);
    const lines = text.split(/\r?\n/);

    const linesToCheck = Math.min(MAX_LINES_TO_CHECK, lines.length);
    for (let i = 0; i < linesToCheck; i++) {
      const line = lines[i] ?? '';
      if (APEXLOG_HEADER.test(line) || EXECUTION_STARTED.test(line) || USER_INFO.test(line)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
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
  const supportedSchemes = ['file', 'vscode-vfs', 'memfs'];

  if (editor && supportedSchemes.includes(editor.document.uri.scheme)) {
    const doc = editor.document;
    if (hasDetectExtension(doc.uri)) {
      const detected = isApexLogContent(doc);
      commands.executeCommand('setContext', 'lana.isApexLog', detected);
      return;
    }
    commands.executeCommand('setContext', 'lana.isApexLog', false);
    return;
  }

  // Fallback to tab API for large files where activeTextEditor is undefined
  const tabUri = getActiveTabUri();
  if (tabUri && supportedSchemes.includes(tabUri.scheme) && hasDetectExtension(tabUri)) {
    // isApexLogFile is async; fire-and-forget is acceptable here for context key update
    void isApexLogFile(tabUri).then((detected) => {
      commands.executeCommand('setContext', 'lana.isApexLog', detected);
    });
    return;
  }

  commands.executeCommand('setContext', 'lana.isApexLog', false);
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
  const supportedSchemes = ['file', 'vscode-vfs', 'memfs'];
  if (doc.languageId === 'apexlog' || !supportedSchemes.includes(doc.uri.scheme)) {
    return;
  }

  if (!hasDetectExtension(doc.uri)) {
    return;
  }

  if (isApexLogContent(doc)) {
    languages.setTextDocumentLanguage(doc, 'apexlog');
  }
}
