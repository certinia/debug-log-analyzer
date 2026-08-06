/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

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

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { subscribeSettings, type LanaSettings } from '../Settings.js';

const requestMock = vscodeMessenger.request as jest.Mock;

function push(activeTheme: string): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { cmd: 'configChanged', payload: { timeline: { activeTheme } } },
    }),
  );
}

describe('subscribeSettings', () => {
  it('follows pushes until the last subscriber leaves', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeSettings((settings: LanaSettings) => {
      seen.push(settings.timeline.activeTheme);
    });

    push('Dark');
    expect(seen).toEqual(['Dark']);

    unsubscribe();
    push('Light');
    expect(seen).toEqual(['Dark']);
  });

  it('seeds again for a subscriber that arrives after the teardown', () => {
    const before = requestMock.mock.calls.length;

    subscribeSettings(() => {})();

    expect(requestMock.mock.calls.length).toBe(before + 1);
  });
});
