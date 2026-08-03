/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import type { LogEvent } from 'apex-log-parser';

import {
  dispatchInspectorReveal,
  INSPECTOR_REVEAL_EVENT,
  type InspectorRevealEvent,
} from '../inspectorReveal.js';
import { revealableEventIndex, type ScopedRow } from '../scopedCallTree.js';

function scopedRow(id: number, eventIndex: number): Partial<ScopedRow> {
  return { id, originalData: { eventIndex } as LogEvent };
}

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

describe('revealableEventIndex', () => {
  it('reveals a real row by its own event', () => {
    expect(revealableEventIndex(scopedRow(3, 17))).toBe(17);
  });

  it('reveals nothing for a merged row, whose id is synthetic and negative', () => {
    expect(revealableEventIndex(scopedRow(-1, 17))).toBeNull();
  });

  it('reveals nothing when there is no row', () => {
    expect(revealableEventIndex(undefined)).toBeNull();
  });
});
