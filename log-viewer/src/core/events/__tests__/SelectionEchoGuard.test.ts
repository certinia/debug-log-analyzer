/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { SelectionEchoGuard } from '../SelectionEchoGuard.js';

describe('SelectionEchoGuard', () => {
  it('suppresses only while the select runs', () => {
    const guard = new SelectionEchoGuard();
    const during: boolean[] = [];

    expect(guard.suppressed).toBe(false);
    const result = guard.run(() => {
      during.push(guard.suppressed);
      return 'selected';
    });

    expect(during).toEqual([true]);
    expect(result).toBe('selected');
    expect(guard.suppressed).toBe(false);
  });

  it('suppresses until an async select settles', async () => {
    const guard = new SelectionEchoGuard();
    let settle: (() => void) | null = null;

    const pending = guard.runAsync(() => new Promise<void>((resolve) => (settle = resolve)));
    expect(guard.suppressed).toBe(true);

    settle!(); // set synchronously by the promise executor above
    await pending;
    expect(guard.suppressed).toBe(false);
  });

  it('stops suppressing when the select throws', () => {
    const guard = new SelectionEchoGuard();

    expect(() =>
      guard.run(() => {
        throw new Error('no such row');
      }),
    ).toThrow('no such row');
    expect(guard.suppressed).toBe(false);
  });
});
