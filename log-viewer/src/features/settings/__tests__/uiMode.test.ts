/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it } from '@jest/globals';

// Hoisted above the import, so the mock can't close over a `const` declared here.
jest.mock('../../../core/messaging/VSCodeExtensionMessenger.js', () => ({
  VSCodeExtensionMessenger: {
    listen: (callback: EventListener) => {
      window.addEventListener('message', callback);
      return () => {
        window.removeEventListener('message', callback);
      };
    },
  },
  vscodeMessenger: { request: jest.fn(() => Promise.reject(new Error('no host'))) },
}));

import { watchUiMode } from '../uiMode.js';

function push(ui?: { mode: 'modern' | 'classic' }): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { cmd: 'configChanged', payload: { timeline: {}, ...(ui ? { ui } : {}) } },
    }),
  );
}

describe('watchUiMode', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    document.documentElement.removeAttribute('data-ui-mode');
  });

  // The panel is never re-created; the docs demo sends no `ui` and must get the Modern defaults.
  it('follows each look the host sends, and sets none when it sends none', () => {
    stop = watchUiMode();

    push({ mode: 'classic' });
    expect(document.documentElement.dataset.uiMode).toBe('classic');
    push({ mode: 'modern' });
    expect(document.documentElement.dataset.uiMode).toBe('modern');
    push();
    expect(document.documentElement.hasAttribute('data-ui-mode')).toBe(false);
  });
});
