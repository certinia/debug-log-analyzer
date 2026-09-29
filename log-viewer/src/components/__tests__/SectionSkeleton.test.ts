/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

import type { LogStatus } from '../../core/log/logStatus.js';
import { NO_GOVERNOR_USAGE_TEXT, NO_LOG_TEXT } from '../governorCopy.js';
import type { SectionSkeleton, SkeletonShape } from '../SectionSkeleton.js';
import '../SectionSkeleton.js';

async function mount(props: {
  logStatus?: LogStatus;
  shape?: SkeletonShape;
  fallback?: string;
}): Promise<SectionSkeleton> {
  const el = document.createElement('section-skeleton') as SectionSkeleton;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** How many bars each row holds, top to bottom. */
function rowWidths(el: SectionSkeleton): string[][] {
  return [...(el.shadowRoot?.querySelectorAll('.row') ?? [])].map((row) =>
    [...row.querySelectorAll<HTMLElement>('.bar')].map((bar) => bar.style.width),
  );
}

function note(el: SectionSkeleton): string | null {
  return el.shadowRoot?.querySelector('.note')?.textContent ?? null;
}

describe('SectionSkeleton', () => {
  it('shimmers while the log parses, saying nothing about a log it cannot see', async () => {
    const el = await mount({ logStatus: 'parsing', shape: 'rows', fallback: 'unused' });

    expect(rowWidths(el)).toEqual([
      ['55%', '20%'],
      ['55%', '20%'],
      ['40%', '20%'],
    ]);
    expect(note(el)).toBeNull();
  });

  it('draws each shape in the layout its section will fill', async () => {
    expect(rowWidths(await mount({ logStatus: 'parsing', shape: 'gauges' }))).toEqual([
      ['30%', '30%', '30%'],
      ['30%', '30%', '30%'],
    ]);
    expect(rowWidths(await mount({ logStatus: 'parsing', shape: 'chart' }))).toEqual([
      ['100%'],
      ['100%'],
    ]);
    expect(rowWidths(await mount({ logStatus: 'parsing', shape: 'bar' }))).toEqual([['100%']]);
  });

  it('keeps every shape pulsing, whatever its name', async () => {
    for (const shape of ['gauges', 'chart', 'rows', 'bar'] as const) {
      const el = await mount({ logStatus: 'parsing', shape });
      const bars = el.shadowRoot?.querySelector('.bars');

      // The bars carry `animation: none`, so a shape class sharing a bar's name
      // would win on order and stop the pulse it sits on.
      expect([...(bars?.classList ?? [])]).not.toContain('bar');
    }
  });

  it('falls back to a known shape rather than rendering nothing', async () => {
    const el = await mount({ logStatus: 'parsing', shape: 'row' as 'rows' });

    expect(rowWidths(el)).toEqual([
      ['55%', '20%'],
      ['55%', '20%'],
      ['40%', '20%'],
    ]);
  });

  it('hands over to the section once the log has arrived', async () => {
    const el = await mount({ logStatus: 'ready', fallback: NO_GOVERNOR_USAGE_TEXT });

    expect(note(el)).toBe(NO_GOVERNOR_USAGE_TEXT);
    expect(rowWidths(el)).toEqual([]);
  });

  it('answers for the log rather than the section when none arrived', async () => {
    // The section's sentence describes a log that was read. On a failed parse
    // there is none, so "no timed calls" would be the original bug reworded.
    const el = await mount({ logStatus: 'failed', fallback: 'The log has no timed calls.' });

    expect(note(el)).toBe(NO_LOG_TEXT);
    expect(rowWidths(el)).toEqual([]);
  });
});
