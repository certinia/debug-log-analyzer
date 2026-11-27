/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { subscribeSettings } from './Settings.js';

/**
 * Mirrors the VS Code look the user chose, Modern or Classic UI, onto `<html>`,
 * where `styles/tokens.css` picks the matching chrome tokens. A host that sends no
 * `ui` (the docs demo, a browser) gets no attribute, so the Modern defaults apply.
 * Returns the unsubscribe.
 */
export function watchUiMode(root: HTMLElement = document.documentElement): () => void {
  return subscribeSettings(({ ui }) => {
    if (ui) {
      root.dataset.uiMode = ui.mode;
    } else {
      delete root.dataset.uiMode;
    }
  });
}
