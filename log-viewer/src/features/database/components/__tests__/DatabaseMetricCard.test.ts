/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import { storeOf } from '#test-helpers/apexLog.js';
import { describeLevelGap } from '../../../../core/log/levelCapabilities.js';
import type { LogStore } from '../../../../core/log/LogStore.js';
import type { DatabaseMetricCard } from '../DatabaseMetricCard.js';
import '../DatabaseMetricCard.js';

async function unknownTitle(store: LogStore): Promise<string | null | undefined> {
  const el = document.createElement('database-metric-card') as DatabaseMetricCard;
  el.metric = { label: 'Statements', found: 2, used: null, limit: 0 };
  el.logStore = store;
  document.body.appendChild(el);
  await el.updateComplete;
  return el.shadowRoot?.querySelector('.na')?.getAttribute('title');
}

describe('DatabaseMetricCard', () => {
  it('names Apex Profiling as the level that fills the consumed figure', async () => {
    const { store } = await storeOf('', '64.0 APEX_CODE,FINE;APEX_PROFILING,NONE;DB,FINEST\n');
    const title = await unknownTitle(store);

    expect(title).toBe(describeLevelGap(store.levelGap('limits')));
    expect(title).toContain('APEX_PROFILING');
  });

  it('names no level when the log was captured high enough', async () => {
    const { store } = await storeOf('', '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO;DB,INFO\n');

    expect(await unknownTitle(store)).toBe(
      'The consumed figure needs cumulative limit usage in the log.',
    );
  });
});
