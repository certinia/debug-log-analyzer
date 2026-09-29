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
import { settingsSettled, subscribeSettings, type LanaSettings } from '../Settings.js';

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

describe('settingsSettled', () => {
  /** 'hung' where the promise never settles — the bug this exists to rule out. */
  async function raceSettle(): Promise<string> {
    return Promise.race([
      settingsSettled().then(() => 'settled'),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 50)),
    ]);
  }

  it('settles when no settings ever arrive, so a waiter can take its default', async () => {
    await expect(raceSettle()).resolves.toBe('settled');
  });

  it('reads again when nobody is following, so no stale read is pinned', async () => {
    const before = requestMock.mock.calls.length;

    await settingsSettled();
    await settingsSettled();

    expect(requestMock.mock.calls.length).toBe(before + 2);
  });

  it('settles once a push has supplied settings', async () => {
    const unsubscribe = subscribeSettings(() => {});
    push('dark');

    await expect(raceSettle()).resolves.toBe('settled');
    unsubscribe();
  });
});
