/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import { CALLTREE_GO_TO_ROW, goToCallTreeAction, goToRow } from '../navigation.js';

function captureEventIds(): { seen: number[]; stop: () => void } {
  const seen: number[] = [];
  const listener = ((e: CustomEvent<{ eventId: number }>) => {
    seen.push(e.detail.eventId);
  }) as EventListener;
  document.addEventListener(CALLTREE_GO_TO_ROW, listener);

  return { seen, stop: () => document.removeEventListener(CALLTREE_GO_TO_ROW, listener) };
}

describe('goToCallTreeAction', () => {
  it('is a labelled issue action that navigates when run', () => {
    const { seen, stop } = captureEventIds();
    const action = goToCallTreeAction(7);

    expect(action.label).toBe('Go to call tree');
    action.run();

    stop();
    expect(seen).toEqual([7]);
  });
});

describe('goToRow', () => {
  it('dispatches the go-to-row event on document with the eventId', async () => {
    const seen: number[] = [];
    const listener = ((e: CustomEvent<{ eventId: number }>) => {
      seen.push(e.detail.eventId);
    }) as EventListener;
    document.addEventListener(CALLTREE_GO_TO_ROW, listener);

    await goToRow({ eventId: 42 });

    document.removeEventListener(CALLTREE_GO_TO_ROW, listener);
    expect(seen).toEqual([42]);
  });
});
