/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { vscodeMessenger } from './VSCodeExtensionMessenger.js';

/**
 * Asks the extension host to write a file, and answers whether it took it. The host
 * is read directly because `send` no-ops outside a webview and returns nothing, so a
 * caller cannot otherwise tell that it has to save the file itself.
 *
 * The payload mirrors `isSaveFileRequest` in `lana/src/commands/LogView.ts`; the
 * packages share no types, so a change here has to be made there too.
 */
export function saveFile(fileContent: string, defaultFileName: string): boolean {
  if (!vscodeMessenger.getVsCodeAPI()) {
    return false;
  }
  vscodeMessenger.send('saveFile', { fileContent, options: { defaultFileName } });
  return true;
}
