/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

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
  it('renders one chip per entry, with swatch color, category and data-category', async () => {
    const el = await mount([
      {
        category: 'Apex',
        fillColor: 'rgb(43, 143, 129)',
        selfTimeNs: 12_100_000_000,
      },
      { category: 'Code Unit', fillColor: 'rgb(109, 76, 125)', selfTimeNs: 500_000 },
    ]);

    const rendered = chips(el);
    expect(rendered).toHaveLength(2);

    const [apex, codeUnit] = rendered;
    expect(apex?.dataset['category']).toBe('Apex');
    expect(apex?.textContent).toContain('Apex');
    expect(apex?.querySelector('color-swatch')?.color).toBe('rgb(43, 143, 129)');
    // `Code Unit` holds a space, so the attribute must carry the category verbatim.
    expect(codeUnit?.dataset['category']).toBe('Code Unit');
  });

  it('shows the compact self time when present', async () => {
    const el = await mount([
      {
        category: 'Apex',
        fillColor: 'rgb(0, 0, 0)',
        selfTimeNs: 12_100_000_000,
      },
    ]);

    expect(chips(el)[0]?.querySelector('.chip__time')?.textContent).toBe('12.1s');
  });

  it('omits the time when self time is unknown', async () => {
    const el = await mount([{ category: 'Apex', fillColor: 'rgb(0, 0, 0)' }]);

    expect(chips(el)[0]?.querySelector('.chip__time')).toBeNull();
  });

  it('keeps the chip itself unfilled — only the swatch carries the category color', async () => {
    const el = await mount([{ category: 'DML', fillColor: 'rgb(176, 104, 104)' }]);

    expect(chips(el)[0]?.getAttribute('style')).toBeNull();
  });

  describe('highlighting a category', () => {
    const entries: TimelineKeyEntry[] = [
      { category: 'Apex', fillColor: 'rgb(0, 0, 0)' },
      { category: 'SOQL', fillColor: 'rgb(0, 0, 0)' },
    ];

    function listen(el: Timelinekey): string[][] {
      const lit: string[][] = [];
      el.addEventListener('highlight-change', (event) =>
        lit.push([...(event as CustomEvent<ReadonlySet<string>>).detail]),
      );
      return lit;
    }

    async function pick(el: Timelinekey, index: number): Promise<void> {
      chips(el)[index]?.click();
      await el.updateComplete;
    }

    function focusByKeyboard(chip: HTMLElement | undefined): void {
      jest
        .spyOn(chip as HTMLElement, 'matches')
        .mockImplementation((selector) => selector === ':focus-visible');
      chip?.dispatchEvent(new Event('focus'));
    }

    function escape(el: Timelinekey, init: KeyboardEventInit = {}): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, ...init });
      chips(el)[0]?.dispatchEvent(event);
      return event;
    }

    it('makes each chip a toggle button', async () => {
      const el = await mount(entries);

      await pick(el, 1);

      const [apex, soql] = chips(el);
      expect(apex?.tagName).toBe('BUTTON');
      expect(apex?.getAttribute('aria-pressed')).toBe('false');
      expect(soql?.getAttribute('aria-pressed')).toBe('true');
    });

    it('lights a clicked category, and drops it on a second click', async () => {
      const el = await mount(entries);
      const lit = listen(el);

      await pick(el, 1);
      await pick(el, 0);
      await pick(el, 1);

      expect(lit).toEqual([['SOQL'], ['SOQL', 'Apex'], ['Apex']]);
    });

    it('previews the category the pointer rests on, and stops after it leaves', async () => {
      const el = await mount(entries);
      const lit = listen(el);
      const soql = chips(el)[1];
      jest.useFakeTimers();

      try {
        soql?.dispatchEvent(new Event('pointerenter'));
        jest.advanceTimersByTime(150);
        soql?.dispatchEvent(new Event('pointerleave'));
        jest.advanceTimersByTime(100);
      } finally {
        jest.useRealTimers();
      }

      expect(lit).toEqual([['SOQL'], []]);
    });

    it('previews nothing for a pointer passing over on its way to the chart', async () => {
      const el = await mount(entries);
      const lit = listen(el);
      const soql = chips(el)[1];
      jest.useFakeTimers();

      try {
        soql?.dispatchEvent(new Event('pointerenter'));
        soql?.dispatchEvent(new Event('pointerleave'));
        jest.runAllTimers();
      } finally {
        jest.useRealTimers();
      }

      expect(lit).toEqual([]);
    });

    it('previews the category under keyboard focus', async () => {
      const el = await mount(entries);
      const lit = listen(el);

      focusByKeyboard(chips(el)[0]);

      expect(lit).toEqual([['Apex']]);
    });

    it('does not preview on the focus a mouse click leaves behind', async () => {
      const el = await mount(entries);
      const lit = listen(el);
      const apex = chips(el)[0];
      jest.spyOn(apex as HTMLElement, 'matches').mockReturnValue(false);

      apex?.dispatchEvent(new Event('focus'));

      expect(lit).toEqual([]);
    });

    it('greys the swatch of every chip the chart dims', async () => {
      const el = await mount(entries);

      await pick(el, 1);

      const [apex, soql] = chips(el);
      expect(apex?.classList.contains('chip--unlit')).toBe(true);
      expect(soql?.classList.contains('chip--unlit')).toBe(false);
    });

    it('keeps the picked chips lit while another is previewed', async () => {
      const el = await mount([...entries, { category: 'DML', fillColor: 'rgb(0, 0, 0)' }]);
      await pick(el, 1);
      const lit = listen(el);

      focusByKeyboard(chips(el)[0]);
      await el.updateComplete;

      expect(lit).toEqual([['SOQL', 'Apex']]);
      expect(chips(el).map((chip) => chip.classList.contains('chip--unlit'))).toEqual([
        false,
        false,
        true,
      ]);
    });

    it('greys nothing when nothing is lit', async () => {
      const el = await mount(entries);

      expect(chips(el).some((chip) => chip.classList.contains('chip--unlit'))).toBe(false);
    });

    it('clears the picks but keeps a preview in progress', async () => {
      const el = await mount(entries);
      await pick(el, 1);
      focusByKeyboard(chips(el)[0]);
      const lit = listen(el);

      const cleared = el.clear();
      await el.updateComplete;

      expect(cleared).toBe(true);
      expect(lit).toEqual([['Apex']]);
      expect(chips(el)[1]?.getAttribute('aria-pressed')).toBe('false');
    });

    it('reports nothing when cleared with nothing picked', async () => {
      const el = await mount(entries);
      const lit = listen(el);

      expect(el.clear()).toBe(false);
      expect(lit).toEqual([]);
    });

    it('clears on Escape and keeps the key from the app-wide deselect', async () => {
      const el = await mount(entries);
      await pick(el, 1);
      const lit = listen(el);

      const event = escape(el);

      expect(lit).toEqual([[]]);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves Escape alone when nothing is picked', async () => {
      const el = await mount(entries);
      const lit = listen(el);

      const event = escape(el);

      expect(lit).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves Escape to the open "+N" menu a chip sits in, so it can close', async () => {
      const menu = document.createElement('div');
      menu.setAttribute('popover', '');
      jest.spyOn(menu, 'matches').mockImplementation((selector) => selector === ':popover-open');
      document.body.appendChild(menu);
      const el = document.createElement('timeline-key') as Timelinekey;
      el.timelineKeys = entries;
      menu.appendChild(el);
      await el.updateComplete;
      await pick(el, 1);
      const lit = listen(el);

      const event = escape(el, { bubbles: true, composed: true });

      expect(lit).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
