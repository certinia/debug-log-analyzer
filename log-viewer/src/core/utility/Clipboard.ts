/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Copies text to the clipboard, ignoring failure — the API is unavailable in
 * some webview contexts and there is nothing useful to tell the user. Callers
 * that drive success/failure UI should await `navigator.clipboard` themselves.
 */
export function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {
    /* clipboard unavailable */
  });
}
