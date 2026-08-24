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
    eventIndexes: [index],
    totalTime: 1_000 - index,
    selfTime: (1_000 - index) / 2,
    count: 1,
    category: 'Apex' as const,
  }));

const pathOf = (frameCount: number): ExecutionHighlights => ({
  totalTime: 1_000,
  hotPath: framesFor(frameCount),
  hotPathEnd: 'hot-spot',
  hotPathBranches: [],
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

const meterWidth = (row: Element) =>
  row.querySelector<HTMLElement>('.reveal-row__meter-fill')!.style.width;

const branchNames = (element: Element) =>
  [...element.shadowRoot!.querySelectorAll('.branch-row .reveal-row__name')].map(
    (name) => name.textContent,
  );

const rowCaptions = (element: Element) =>
  [...element.shadowRoot!.querySelectorAll('.reveal-row__sub')].map((sub) => sub.textContent);

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

  it('colours each row by category and splits the bar at its self time', async () => {
    highlights = pathOf(1);

    const element = await hotPath();

    const row = element.shadowRoot?.querySelector<HTMLElement>('.reveal-row');
    expect(row?.style.getPropertyValue('--row-hue')).not.toBe('');
    // The bar runs to the frame's share of the log and is solid up to its self
    // time; half the frame's total time is its own, and the path stops here, so
    // the other half sits below it off the path.
    expect(meterWidth(row!)).toBe('100%');
    expect(row?.style.getPropertyValue('--self-pct')).toBe('50%');
    expect(row?.querySelector('.reveal-row__sub')?.textContent).toBe(
      'self 0.001 ms (50.0%) \u00b7 0.001 ms (50.0%) below this frame \u00b7 the hot spot',
    );
    // The hue is decorative, so the category is named in text a reader can hear.
    expect(row?.querySelector('.reveal-row__swatch')).toBeNull();
    expect(row?.querySelector('.reveal-row__sr')?.textContent).toBe('Apex');
  });

  it('keeps the last frame and collapses the middle of a longer path', async () => {
    highlights = pathOf(14);

    const element = await hotPath();

    // Nine frames from the entry point, then the last frame, with the dropped
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

  it('sums the path in one line above the rows', async () => {
    highlights = pathOf(3);

    const element = await hotPath();

    expect(element.shadowRoot?.querySelector('.summary')?.textContent?.trim()).toBe(
      '3 frames \u00b7 0.001 ms at entry \u2192 0.001 ms (99.8%) at the last frame',
    );
  });

  it('splits each row into what it kept, passed on and shed', async () => {
    highlights = {
      totalTime: 1_000,
      hotPath: [
        { ...framesFor(1)[0]!, text: 'Parent', totalTime: 1_000, selfTime: 100 },
        { ...framesFor(1)[0]!, text: 'Child', totalTime: 700, selfTime: 700 },
      ],
      hotPathEnd: 'hot-spot',
      hotPathBranches: [],
      hotSpots: [],
      truncation: null,
    };

    const element = await hotPath();

    const rows = element.shadowRoot!.querySelectorAll<HTMLElement>('.reveal-row');
    // The parent kept 100ns, passed 700ns down, so 200ns went to branches.
    expect(meterWidth(rows[0]!)).toBe('100%');
    expect(rows[0]!.style.getPropertyValue('--self-pct')).toBe('10%');
    expect(meterWidth(rows[1]!)).toBe('70%');
    expect(rowCaptions(element)).toEqual([
      'self 0 ms (10.0%) \u00b7 0 ms (20.0%) to branches',
      'self 0.001 ms (70.0%) \u00b7 the hot spot',
    ]);
  });

  it('names the ways the last frame fans out, and lists them', async () => {
    highlights = {
      totalTime: 1_000,
      hotPath: [{ ...framesFor(1)[0]!, text: 'Parent', totalTime: 1_000, selfTime: 100 }],
      hotPathEnd: 'fan-out',
      hotPathBranches: [
        {
          text: 'Alpha',
          eventIndex: 7,
          eventIndexes: [7],
          totalTime: 400,
          selfTime: 0,
          count: 1,
          category: 'Apex',
        },
        {
          text: 'Beta',
          eventIndex: 8,
          eventIndexes: [8, 11],
          totalTime: 300,
          selfTime: 0,
          count: 2,
          category: 'Apex',
        },
      ],
      hotSpots: [],
      truncation: null,
    };

    const element = await hotPath();

    expect(rowCaptions(element)).toEqual([
      'self 0 ms (10.0%) \u00b7 0.001 ms (90.0%) below this frame \u00b7 fans out 2 ways',
    ]);
    expect(branchNames(element)).toEqual(['Alpha', 'Beta']);
    // A branch is a pointer, so it gives a time and a share and no split.
    const branch = element.shadowRoot!.querySelectorAll('.branch-row')[1]!;
    expect(
      branch.querySelector('.reveal-row__value')?.textContent?.replace(/\s+/g, ' ').trim(),
    ).toBe('2\u00d7 \u00b7 0 ms \u00b7 30.0%');
    expect(branch.querySelector('.reveal-row__meter')).toBeNull();
    // The last frame only splits the time up, so nothing is emphasised.
    expect(element.shadowRoot?.querySelectorAll('.reveal-row--focus')).toHaveLength(0);
  });

  it('counts the branches past the third in a line', async () => {
    highlights = {
      totalTime: 1_000,
      hotPath: [{ ...framesFor(1)[0]!, text: 'Parent', totalTime: 1_000, selfTime: 100 }],
      hotPathEnd: 'fan-out',
      hotPathBranches: ['A', 'B', 'C', 'D', 'E'].map((text, index) => ({
        text,
        eventIndex: index,
        eventIndexes: [index],
        totalTime: 100 - index,
        selfTime: 0,
        count: 1,
        category: 'Apex' as const,
      })),
      hotSpots: [],
      truncation: null,
    };

    const element = await hotPath();

    expect(branchNames(element)).toEqual(['A', 'B', 'C']);
    expect(element.shadowRoot?.querySelector('.more')?.textContent).toContain('2 more branches');
    // The caption counts every way the time went, not the rows that fit.
    expect(rowCaptions(element)[0]).toContain('fans out 5 ways');
  });

  it('marks every merged instance of a branch under the pointer', async () => {
    highlights = {
      totalTime: 1_000,
      hotPath: [{ ...framesFor(1)[0]!, text: 'Parent', totalTime: 1_000, selfTime: 100 }],
      hotPathEnd: 'fan-out',
      hotPathBranches: [
        {
          text: 'Beta',
          eventIndex: 8,
          eventIndexes: [8, 11],
          totalTime: 300,
          selfTime: 0,
          count: 2,
          category: 'Apex',
        },
      ],
      hotSpots: [],
      truncation: null,
    };
    const element = await hotPath();
    const marks: (readonly number[])[] = [];
    element.addEventListener('inspector-locate', (event) => {
      marks.push((event as CustomEvent<{ eventIndexes: readonly number[] }>).detail.eventIndexes);
    });

    const branch = element.shadowRoot!.querySelector('.branch-row')!;
    branch.dispatchEvent(new Event('pointerenter'));
    branch.dispatchEvent(new Event('pointerleave'));

    expect(marks).toEqual([[8, 11], []]);
    // One branch is no fan, so the caption says only that the time is below.
    expect(rowCaptions(element)[0]).toContain('fans out below');
  });

  it('names each part of the bar for the pointer', async () => {
    highlights = {
      totalTime: 1_000,
      hotPath: [
        { ...framesFor(1)[0]!, text: 'Parent', totalTime: 1_000, selfTime: 100 },
        { ...framesFor(1)[0]!, text: 'Child', totalTime: 700, selfTime: 700 },
      ],
      hotPathEnd: 'hot-spot',
      hotPathBranches: [],
      hotSpots: [],
      truncation: null,
    };

    const element = await hotPath();

    const hits = [
      ...element
        .shadowRoot!.querySelectorAll<HTMLElement>('.reveal-row')[0]!
        .querySelectorAll<HTMLElement>('.reveal-row__meter-hit'),
    ];
    expect(hits.map((hit) => [hit.style.width, hit.title])).toEqual([
      ['10%', 'self 0 ms'],
      ['70%', '0.001 ms on the path'],
      ['20%', '0 ms to branches'],
    ]);
  });

  it('marks every merged instance of the row under the pointer', async () => {
    highlights = pathOf(1);
    highlights.hotPath[0]!.eventIndexes = [4, 9];
    const element = await hotPath();
    const marks: (readonly number[])[] = [];
    element.addEventListener('inspector-locate', (event) => {
      marks.push((event as CustomEvent<{ eventIndexes: readonly number[] }>).detail.eventIndexes);
    });

    const row = element.shadowRoot!.querySelector('.reveal-row')!;
    row.dispatchEvent(new Event('pointerenter'));
    row.dispatchEvent(new Event('pointerleave'));

    expect(marks).toEqual([[4, 9], []]);
  });
});
