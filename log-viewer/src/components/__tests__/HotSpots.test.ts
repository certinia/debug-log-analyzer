/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { LogStore } from '../../core/log/LogStore.js';
import type { ExecutionHighlights } from '../../features/call-tree/utils/ExecutionHighlights.js';

let highlights: ExecutionHighlights | null = null;
jest.mock('../../features/call-tree/utils/ExecutionHighlights.js', () => ({
  getExecutionHighlights: () => highlights,
}));

import '../HotSpots.js';

const spotsOf = (): ExecutionHighlights => ({
  totalTime: 1_000_000_000,
  hotPath: [],
  hotSpots: [
    {
      text: 'MyClass.run()',
      eventIndex: 3,
      selfTime: 200_000_000,
      totalTime: 400_000_000,
      count: 4,
      category: 'Apex',
    },
  ],
  truncation: null,
});

const hotSpots = async () => {
  const element = document.createElement('hot-spots');
  element.logStore = { log: {} } as unknown as LogStore;
  document.body.append(element);
  await element.updateComplete;
  return element;
};

describe('hot-spots', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    highlights = null;
  });

  it('reads the churn as calls, average and share of the log', async () => {
    highlights = spotsOf();

    const element = await hotSpots();

    // 200 ms of self time over 4 calls is 50 ms each, a fifth of a 1 s log.
    expect(element.shadowRoot?.querySelector('.reveal-row__sub')?.textContent).toBe(
      '4× · 50 ms self avg · 20.0% of log',
    );
  });

  it('colours the row by category and splits the meter at its self time', async () => {
    highlights = spotsOf();

    const element = await hotSpots();

    const row = element.shadowRoot?.querySelector<HTMLElement>('.reveal-row');
    expect(row?.style.getPropertyValue('--row-hue')).not.toBe('');
    // The bar runs to the 40% total share; half of it — the 20% self share — is solid.
    expect(row?.style.getPropertyValue('--self-pct')).toBe('50%');
    expect(row?.querySelector('.reveal-row__swatch')?.getAttribute('title')).toBe('Apex');
    // The hue is decorative, so the category is named in text a reader can hear.
    expect(row?.querySelector('.reveal-row__swatch')?.getAttribute('aria-hidden')).toBe('true');
    expect(row?.querySelector('.reveal-row__sr')?.textContent).toBe('Apex');
    expect(
      element.shadowRoot?.querySelector<HTMLElement>('.reveal-row__meter-fill')?.style.width,
    ).toBe('40%');
  });

  it('notes a log with no timed calls', async () => {
    highlights = { totalTime: 0, hotPath: [], hotSpots: [], truncation: null };

    const element = await hotSpots();

    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('no timed calls');
  });
});
