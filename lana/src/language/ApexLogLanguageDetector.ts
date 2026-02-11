/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

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

const APEXLOG_HEADER = /^\d\d\.\d.+?APEX_CODE,\w.+$/;
const DETECT_EXTENSIONS = new Set(['.log', '.txt']);
const MAX_LINES_TO_CHECK = 100;

export function isApexLogContent(doc: TextDocument): boolean {
  if (doc.lineCount === 0) {
    return false;
  }

  const linesToCheck = Math.min(MAX_LINES_TO_CHECK, doc.lineCount);
  for (let i = 0; i < linesToCheck; i++) {
    if (APEXLOG_HEADER.test(doc.lineAt(i).text)) {
      return true;
    }
  }

  return false;
}

async function isApexLogFile(fsPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = createReadStream(fsPath, { encoding: 'utf8', end: 4096 });
    const rl = createInterface({ input: stream });
    let lineNumber = 0;
    let found = false;

    rl.on('line', (line) => {
      if (APEXLOG_HEADER.test(line)) {
        found = true;
        rl.close();
        stream.destroy();
      }
      if (++lineNumber >= MAX_LINES_TO_CHECK) {
        rl.close();
        stream.destroy();
      }
    });

    rl.on('close', () => resolve(found));
    stream.on('error', () => resolve(false));
  });
}

function hasDetectExtension(uri: Uri): boolean {
  const filePath = uri.fsPath;
  return DETECT_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf('.')).toLowerCase());
}

function getActiveTabUri(): Uri | undefined {
  const activeTab = window.tabGroups.activeTabGroup.activeTab;
  if (activeTab?.input instanceof TabInputText) {
    return activeTab.input.uri;
  }
  return undefined;
}

async function updateContextKey(): Promise<void> {
  // Try activeTextEditor first (works for files < 50MB)
  const editor = window.activeTextEditor;
  if (editor && editor.document.uri.scheme === 'file') {
    const doc = editor.document;
    if (doc.languageId === 'apexlog') {
      await commands.executeCommand('setContext', 'lana.isApexLog', true);
      return;
    }
    if (hasDetectExtension(doc.uri)) {
      const detected = isApexLogContent(doc) || (await isApexLogFile(doc.uri.fsPath));
      await commands.executeCommand('setContext', 'lana.isApexLog', detected);
      return;
    }
    await commands.executeCommand('setContext', 'lana.isApexLog', false);
    return;
  }

  // Fallback to tab API for large files where activeTextEditor is undefined
  const tabUri = getActiveTabUri();
  if (tabUri && tabUri.scheme === 'file' && hasDetectExtension(tabUri)) {
    const detected = await isApexLogFile(tabUri.fsPath);
    await commands.executeCommand('setContext', 'lana.isApexLog', detected);
    return;
  }

  await commands.executeCommand('setContext', 'lana.isApexLog', false);
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
