/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import type { LogStatus } from '../../core/log/logStatus.js';
import type { GridSkeleton } from '../GridSkeleton.js';
import '../GridSkeleton.js';

async function bars(props: { logStatus: LogStatus; pending?: boolean }): Promise<number> {
  const el = document.createElement('grid-skeleton') as GridSkeleton;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el.shadowRoot?.querySelectorAll('.skeleton').length ?? 0;
}

describe('GridSkeleton', () => {
  it('shimmers while the log parses', async () => {
    expect(await bars({ logStatus: 'parsing' })).toBeGreaterThan(0);
  });

  it('draws nothing once the log is ready', async () => {
    expect(await bars({ logStatus: 'ready' })).toEqual(0);
  });

  it('keeps shimmering after the parse while the grid still derives its rows', async () => {
    expect(await bars({ logStatus: 'ready', pending: true })).toBeGreaterThan(0);
  });
});
