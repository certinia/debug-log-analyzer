/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { ExecutionHighlights } from '../../features/call-tree/utils/ExecutionHighlights.js';

jest.mock('#vscode-elements/vscode-icon.js', () => ({}));

let highlights: ExecutionHighlights | null = null;
jest.mock('../../features/call-tree/utils/ExecutionHighlights.js', () => ({
  getCurrentExecutionHighlights: () => highlights,
}));

import '../HotPath.js';

const framesFor = (count: number) =>
  Array.from({ length: count }, (_unused, index) => ({
    text: `Frame${index}`,
    eventIndex: index,
    totalTime: 1_000 - index,
    count: 1,
  }));

const pathOf = (frameCount: number): ExecutionHighlights => ({
  totalTime: 1_000,
  hotPath: framesFor(frameCount),
  hotSpots: [],
  truncation: null,
});

const hotPath = async () => {
  const element = document.createElement('hot-path');
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
