/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { closeSync, openSync, readSync } from 'node:fs';
import { extname } from 'node:path';

import {
  TabInputText,
  commands,
  languages,
  window,
  workspace,
  type TextDocument,
  type Uri,
} from 'vscode';

import { Context } from '../Context.js';

const APEXLOG_HEADER = /^(\d\d\.\d.+?)?APEX_CODE,\w.+$/;
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

function isApexLogFile(fsPath: string): boolean {
  let fd: number;
  try {
    fd = openSync(fsPath, 'r');
  } catch {
    return false;
  }

  try {
    const buf = Buffer.alloc(4096);
    const bytesRead = readSync(fd, buf, 0, 4096, 0);
    const text = buf.toString('utf8', 0, bytesRead);
    const lines = text.split(/\r?\n/);

    const linesToCheck = Math.min(MAX_LINES_TO_CHECK, lines.length);
    for (let i = 0; i < linesToCheck; i++) {
      const line = lines[i] ?? '';
      if (APEXLOG_HEADER.test(line) || EXECUTION_STARTED.test(line) || USER_INFO.test(line)) {
        return true;
      }
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

function hasDetectExtension(uri: Uri): boolean {
  return DETECT_EXTENSIONS.has(extname(uri.fsPath).toLowerCase());
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
  if (editor && editor.document.uri.scheme === 'file') {
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
  if (tabUri && tabUri.scheme === 'file' && hasDetectExtension(tabUri)) {
    const detected = isApexLogFile(tabUri.fsPath);
    commands.executeCommand('setContext', 'lana.isApexLog', detected);
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
  if (doc.languageId === 'apexlog' || doc.uri.scheme !== 'file') {
    return;
  }

  if (!hasDetectExtension(doc.uri)) {
    return;
  }

  if (isApexLogContent(doc)) {
    languages.setTextDocumentLanguage(doc, 'apexlog');
  }
}
