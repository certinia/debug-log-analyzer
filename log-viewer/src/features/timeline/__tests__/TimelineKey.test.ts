/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// jsdom can't run the real element (vscode-icon reads document.baseURI).
jest.mock('../../../components/OverflowList.js', () => ({}));

import type { TimelineKeyEntry, Timelinekey } from '../components/TimelineKey.js';
import '../components/TimelineKey.js';

async function mount(entries: TimelineKeyEntry[]): Promise<Timelinekey> {
  const el = document.createElement('timeline-key') as Timelinekey;
  el.timelineKeys = entries;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function chips(el: Timelinekey): HTMLElement[] {
  return [...(el.shadowRoot?.querySelectorAll<HTMLElement>('.chip') ?? [])];
}

describe('TimelineKey', () => {
  it('renders one chip per entry, with swatch color, label and data-category', async () => {
    const el = await mount([
      {
        label: 'Apex',
        fillColor: 'rgb(43, 143, 129)',
        categories: ['Apex'],
        selfTimeNs: 12_100_000_000,
      },
      { label: 'SOQL', fillColor: 'rgb(109, 76, 125)', categories: ['SOQL'], selfTimeNs: 500_000 },
    ]);

    const rendered = chips(el);
    expect(rendered).toHaveLength(2);

    const [apex] = rendered;
    expect(apex?.dataset['category']).toBe('Apex');
    expect(apex?.textContent).toContain('Apex');
    expect(apex?.querySelector('color-swatch')?.color).toBe('rgb(43, 143, 129)');
  });

  // Comma, not space: `Code Unit` is one category that contains a space, so a
  // space-joined list could not be split back apart.
  it('lists every folded category, splittable on the comma', async () => {
    const el = await mount([
      {
        label: 'Method',
        fillColor: 'rgb(1, 2, 3)',
        categories: ['Apex', 'Callout'],
        selfTimeNs: 1_000,
      },
      { label: 'Code Unit', fillColor: 'rgb(4, 5, 6)', categories: ['Code Unit'] },
    ]);

    const [method, codeUnit] = chips(el);
    expect(method?.dataset['category']?.split(',')).toEqual(['Apex', 'Callout']);
    expect(codeUnit?.dataset['category']?.split(',')).toEqual(['Code Unit']);
  });

  it('shows the compact self time when present', async () => {
    const el = await mount([
      {
        label: 'Apex',
        fillColor: 'rgb(0, 0, 0)',
        categories: ['Apex'],
        selfTimeNs: 12_100_000_000,
      },
    ]);

    expect(chips(el)[0]?.querySelector('.chip__time')?.textContent).toBe('12.1s');
  });

  it('omits the time when self time is unknown', async () => {
    const el = await mount([{ label: 'Method', fillColor: 'rgb(0, 0, 0)', categories: ['Apex'] }]);

    expect(chips(el)[0]?.querySelector('.chip__time')).toBeNull();
  });

  it('keeps the chip itself unfilled — only the swatch carries the category color', async () => {
    const el = await mount([
      { label: 'DML', fillColor: 'rgb(176, 104, 104)', categories: ['DML'] },
    ]);

    expect(chips(el)[0]?.getAttribute('style')).toBeNull();
  });
});
