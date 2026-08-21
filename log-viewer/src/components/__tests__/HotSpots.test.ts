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
  hotPathEnd: 'hot-spot',
  hotPathBranches: [],
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
      '4× · 50 ms self avg · 20.0% of log · 200 ms below',
    );
  });

  it('colours the row by category and splits the meter at its self time', async () => {
    highlights = spotsOf();

    const element = await hotSpots();

    const row = element.shadowRoot?.querySelector<HTMLElement>('.reveal-row');
    expect(row?.style.getPropertyValue('--row-hue')).not.toBe('');
    // The bar runs to the 40% total share; half of it — the 20% self share — is solid.
    expect(row?.style.getPropertyValue('--self-pct')).toBe('50%');
    // The hue is decorative, so the category is named in text a reader can hear.
    expect(row?.querySelector('.reveal-row__swatch')).toBeNull();
    expect(row?.querySelector('.reveal-row__sr')?.textContent).toBe('Apex');
    expect(
      element.shadowRoot?.querySelector<HTMLElement>('.reveal-row__meter-fill')?.style.width,
    ).toBe('40%');
  });

  it('names the two parts of the bar for the pointer', async () => {
    highlights = spotsOf();

    const element = await hotSpots();

    const hits = [...element.shadowRoot!.querySelectorAll<HTMLElement>('.reveal-row__meter-hit')];
    // The parts are shares of the log, so they add up to the bar's own length.
    expect(hits.map((hit) => [hit.style.width, hit.title])).toEqual([
      ['20%', 'self 200 ms'],
      ['20%', '200 ms in the calls below'],
    ]);
  });

  it('gives the whole split as the row title, where the bar has no part', async () => {
    highlights = spotsOf();

    const element = await hotSpots();

    const split = '4 calls merged · total 400 ms · self 200 ms · 200 ms in the calls below';
    expect(element.shadowRoot?.querySelector<HTMLElement>('.reveal-row')?.title).toBe(split);
    // The band carries it too, so the space past the bar is a titled element.
    expect(element.shadowRoot?.querySelector<HTMLElement>('.reveal-row__meter-hits')?.title).toBe(
      split,
    );
  });

  it('notes a log with no timed calls', async () => {
    highlights = {
      totalTime: 0,
      hotPath: [],
      hotPathEnd: 'hot-spot',
      hotPathBranches: [],
      hotSpots: [],
      truncation: null,
    };

    const element = await hotSpots();

    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('no timed calls');
  });
});
