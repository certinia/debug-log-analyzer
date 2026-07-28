/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import { CALLTREE_GO_TO_ROW, goToRow } from '../navigation.js';

describe('goToRow', () => {
  it('dispatches the go-to-row event on document with the eventIndex', async () => {
    const seen: number[] = [];
    const listener = ((e: CustomEvent<{ eventIndex: number }>) => {
      seen.push(e.detail.eventIndex);
    }) as EventListener;
    document.addEventListener(CALLTREE_GO_TO_ROW, listener);

    await goToRow({ eventIndex: 42 });

    document.removeEventListener(CALLTREE_GO_TO_ROW, listener);
    expect(seen).toEqual([42]);
  });
});
