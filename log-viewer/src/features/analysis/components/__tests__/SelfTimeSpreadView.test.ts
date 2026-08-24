/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { LogStore } from '../../../../core/log/LogStore.js';
import type { SelfTimeSpread } from '../../services/SelfTimeSpread.js';

let spread: SelfTimeSpread | null = null;
jest.mock('../../services/SelfTimeSpread.js', () => ({
  ...jest.requireActual<object>('../../services/SelfTimeSpread.js'),
  getSelfTimeSpread: () => spread,
}));

import '../SelfTimeSpreadView.js';

// Durations are nanoseconds, so the readings are set far enough apart to format apart.
const rowOf = (overrides: Partial<SelfTimeSpread['lanes'][number]> = {}) => ({
  text: 'AccountService.save()',
  category: 'Apex' as const,
  eventIndex: 7,
  count: 10,
  selfTime: 218_000_000,
  median: 2_000_000,
  p95: 200_000_000,
  max: 200_000_000,
  bins: [9, 0, 0, 1],
  heights: [100, 0, 0, 10],
  ...overrides,
});

const spreadOf = (overrides: Partial<SelfTimeSpread> = {}): SelfTimeSpread => ({
  lanes: [rowOf()],
  singles: [],
  concentration: { signatures: 1, total: 1 },
  ...overrides,
});

const view = async () => {
  const element = document.createElement('self-time-spread');
  element.logStore = { log: {} } as unknown as LogStore;
  document.body.append(element);
  await element.updateComplete;
  return element;
};

const text = (element: Element, selector: string) =>
  element.shadowRoot!.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

describe('self-time-spread', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    spread = null;
  });

  it('says the log timed nothing when it has no reading', async () => {
    const element = await view();

    expect(text(element, '.note')).toBe('The log has no timed calls.');
  });

  it('heads the lanes with how few signatures hold the self time', async () => {
    spread = spreadOf({ concentration: { signatures: 3, total: 412 } });

    const element = await view();

    expect(text(element, '.summary')).toBe('80% of self time in 3 of 412 signatures');
  });

  it('names the self time it holds and the readings that place it', async () => {
    spread = spreadOf();

    const element = await view();

    expect(text(element, '.reveal-row__name')).toBe('AccountService.save()');
    // The headline is the self time the signature holds, as every ranked row gives.
    expect(text(element, '.reveal-row__value--primary')).toBe('218 ms');
    expect(text(element, '.reveal-row__sub')).toBe('10 timed calls · med 2 ms · p95 200 ms');
    expect(element.shadowRoot?.querySelector('.reveal-row')?.getAttribute('title')).toBe(
      '10 timed calls · self 218 ms · median 2 ms · 95th 200 ms · worst 200 ms',
    );
    // The hue is decorative, so the category is named in text a reader can hear.
    expect(text(element, '.reveal-row__sr')).toBe('Apex');
    // No swatch, so the name must take the flexible track and truncate there.
    expect(element.shadowRoot?.querySelector('.reveal-row')?.classList).toContain(
      'reveal-row--no-swatch',
    );
  });

  it('draws a bin per bucket at the height the lane worked out', async () => {
    spread = spreadOf();

    const element = await view();

    const bins = [...element.shadowRoot!.querySelectorAll<HTMLElement>('.spread__bin')];
    expect(bins.map((bin) => bin.style.height)).toEqual(['100%', '0%', '0%', '10%']);
  });

  it('marks the median and the 95th call across the lane', async () => {
    spread = spreadOf();

    const element = await view();

    const ticks = [...element.shadowRoot!.querySelectorAll<HTMLElement>('.spread__tick')];
    expect(ticks.map((tick) => tick.style.left)).toEqual(['1%', '100%']);
  });

  it('reveals the signature’s worst call when a lane is clicked', async () => {
    spread = spreadOf({ lanes: [rowOf({ eventIndex: 42 })] });
    const element = await view();
    const revealed: number[] = [];
    element.addEventListener('inspector-reveal', (event) => {
      revealed.push((event as CustomEvent<{ eventIndex: number }>).detail.eventIndex);
    });

    element.shadowRoot!.querySelector<HTMLElement>('.reveal-row')!.click();

    expect(revealed).toEqual([42]);
  });

  it('reads out the bin the pointer is over, in place of the readings', async () => {
    spread = spreadOf();
    const element = await view();
    const lane = element.shadowRoot!.querySelector<HTMLElement>('.spread')!;
    lane.getBoundingClientRect = () => ({ left: 0, width: 100 }) as unknown as DOMRect;

    // jsdom has no PointerEvent; a MouseEvent carries every field read here.
    lane.dispatchEvent(new MouseEvent('pointermove', { clientX: 1, bubbles: true }));
    await element.updateComplete;

    // The first bin holds nine of the ten calls, up to a twenty-fourth of the worst.
    expect(text(element, '.reveal-row__sub')).toBe('9 calls · 0 ms to 8.33 ms');
    expect(element.shadowRoot!.querySelectorAll('.spread__bin--hovered').length).toBe(1);
  });

  it('gives a one-off call a plain row, with no lane to read', async () => {
    spread = spreadOf({
      lanes: [],
      singles: [
        {
          text: 'DML Op:Insert Type:Account',
          category: 'DML',
          eventIndex: 9,
          selfTime: 4_000_000,
        },
      ],
    });

    const element = await view();

    expect(text(element, '.group')).toBe('Ran once');
    expect(text(element, '.reveal-row__name')).toBe('DML Op:Insert Type:Account');
    expect(text(element, '.reveal-row__value--primary')).toBe('4 ms');
    expect(element.shadowRoot!.querySelector('.spread')).toBeNull();
  });
});
