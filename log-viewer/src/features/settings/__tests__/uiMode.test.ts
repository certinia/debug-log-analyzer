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

  // The docs demo and a browser host send no `ui`, and must get VS Code's default look.
  it('sets nothing when the host sends no ui, so the Modern defaults apply', () => {
    stop = watchUiMode();
    push();

    expect(document.documentElement.hasAttribute('data-ui-mode')).toBe(false);
  });

  it('marks the classic look, which is what the Classic token overrides key on', () => {
    stop = watchUiMode();
    push({ mode: 'classic' });

    expect(document.documentElement.dataset.uiMode).toBe('classic');
  });

  // The panel is never re-created, so a switch in VS Code must reach the open view.
  it('follows a later switch back to Modern', () => {
    stop = watchUiMode();
    push({ mode: 'classic' });
    push({ mode: 'modern' });

    expect(document.documentElement.dataset.uiMode).toBe('modern');
  });
});
