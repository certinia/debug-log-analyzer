/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { storeOf } from '#test-helpers/apexLog.js';
import { LogStore } from '../../core/log/LogStore.js';
import type { CategoryTimeBar } from '../CategoryTimeBar.js';
import '../CategoryTimeBar.js';

const LOG =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1100)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
  '09:18:22.6 (1600)|SOQL_EXECUTE_END|[2]|Rows:1\n' +
  '09:18:22.6 (1800)|METHOD_EXIT|[1]|ns.Outer.run()\n';

// The first render only starts the index; the slices land a task later.
async function settle(element: CategoryTimeBar): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    await element.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(logStore: LogStore | null): Promise<CategoryTimeBar> {
  const element = document.createElement('category-time-bar');
  // No provider in the test, so the consumed store is assigned straight on.
  Object.assign(element, { logStore });
  document.body.append(element);
  await settle(element);
  return element;
}

const labels = (element: CategoryTimeBar) =>
  element.shadowRoot?.querySelector('stacked-time-bar')?.segments.map(({ label }) => label) ?? [];

describe('category-time-bar', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("draws the log's self time by category once its index is built", async () => {
    const element = await mount(storeOf(LOG).store);

    expect(labels(element)).toEqual(expect.arrayContaining(['SOQL', 'Apex']));
  });

  it('follows the log it is given', async () => {
    const element = await mount(storeOf(LOG).store);
    Object.assign(element, {
      logStore: storeOf(
        '09:18:22.6 (1000)|DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:1\n' +
          '09:18:22.6 (1500)|DML_END|[1]\n',
      ).store,
    });
    await settle(element);

    expect(labels(element)).toContain('DML');
    expect(labels(element)).not.toContain('SOQL');
  });

  it('stops waiting when the index build fails', async () => {
    jest.spyOn(LogStore.prototype, 'logIndex').mockRejectedValue(new Error('index build failed'));

    const element = await mount(storeOf(LOG).store);

    expect(element.shadowRoot?.querySelector('section-skeleton')?.pending).toBe(false);
  });

  it('keeps the parse skeleton until a log arrives', async () => {
    const element = await mount(null);

    expect(element.shadowRoot?.querySelector('section-skeleton')).not.toBeNull();
  });
});
