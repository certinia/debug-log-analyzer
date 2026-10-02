/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import {
  dispatchInspectorReveal,
  INSPECTOR_REVEAL_EVENT,
  type InspectorRevealEvent,
} from '../inspectorReveal.js';

describe('dispatchInspectorReveal', () => {
  it('raises a composed event that escapes the section shadow root', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const section = document.createElement('div');
    shadow.appendChild(section);
    document.body.appendChild(host);

    const seen: number[] = [];
    document.addEventListener(INSPECTOR_REVEAL_EVENT, (e) => {
      seen.push((e as InspectorRevealEvent).detail.eventIndex);
    });

    dispatchInspectorReveal(section, 42);

    expect(seen).toEqual([42]);
  });
});
