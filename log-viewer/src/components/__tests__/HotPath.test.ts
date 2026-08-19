/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { LogStore } from '../../core/log/LogStore.js';
import type { ExecutionHighlights } from '../../features/call-tree/utils/ExecutionHighlights.js';

jest.mock('#vscode-elements/vscode-icon.js', () => ({}));

let highlights: ExecutionHighlights | null = null;
jest.mock('../../features/call-tree/utils/ExecutionHighlights.js', () => ({
  getExecutionHighlights: () => highlights,
}));

import '../HotPath.js';

const framesFor = (count: number) =>
  Array.from({ length: count }, (_unused, index) => ({
    text: `Frame${index}`,
    eventIndex: index,
    totalTime: 1_000 - index,
    selfTime: (1_000 - index) / 2,
    count: 1,
    category: 'Apex' as const,
  }));

const pathOf = (frameCount: number): ExecutionHighlights => ({
  totalTime: 1_000,
  hotPath: framesFor(frameCount),
  hotSpots: [],
  truncation: null,
});

const hotPath = async () => {
  const element = document.createElement('hot-path');
  element.logStore = { log: {} } as unknown as LogStore;
  document.body.append(element);
  await element.updateComplete;
  return element;
};

const rowNames = (element: Element) =>
  [...element.shadowRoot!.querySelectorAll('.reveal-row__name')].map((name) => name.textContent);

describe('hot-path', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    highlights = null;
  });

  it('emphasises the last frame of a path that fits', async () => {
    highlights = pathOf(3);

    const element = await hotPath();

    expect(rowNames(element)).toEqual(['Frame0', 'Frame1', 'Frame2']);
    expect(element.shadowRoot?.querySelector('.more')).toBeNull();
    const focused = element.shadowRoot?.querySelectorAll('.reveal-row--focus');
    expect(focused).toHaveLength(1);
    expect(focused?.[0]?.textContent).toContain('Frame2');
  });

  it('colours each row by category and splits the meter at its self time', async () => {
    highlights = pathOf(1);

    const element = await hotPath();

    const row = element.shadowRoot?.querySelector<HTMLElement>('.reveal-row');
    expect(row?.style.getPropertyValue('--row-hue')).not.toBe('');
    // Half the frame's total time is its own, so the solid head is half the bar.
    expect(row?.style.getPropertyValue('--self-pct')).toBe('50%');
    expect(row?.querySelector('.reveal-row__swatch')?.getAttribute('title')).toBe('Apex');
    // The hue is decorative, so the category is named in text a reader can hear.
    expect(row?.querySelector('.reveal-row__swatch')?.getAttribute('aria-hidden')).toBe('true');
    expect(row?.querySelector('.reveal-row__sr')?.textContent).toBe('Apex');
  });

  it('keeps the terminus and collapses the middle of a longer path', async () => {
    highlights = pathOf(14);

    const element = await hotPath();

    // Nine frames from the entry point, then the terminus, with the dropped
    // frames counted between them.
    expect(rowNames(element)).toEqual([
      'Frame0',
      'Frame1',
      'Frame2',
      'Frame3',
      'Frame4',
      'Frame5',
      'Frame6',
      'Frame7',
      'Frame8',
      'Frame13',
    ]);
    expect(element.shadowRoot?.querySelector('.more')?.textContent).toContain('4 more frames');
    const focused = element.shadowRoot?.querySelectorAll('.reveal-row--focus');
    expect(focused).toHaveLength(1);
    expect(focused?.[0]?.textContent).toContain('Frame13');
  });
});
