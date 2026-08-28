/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { InspectorEmphasis } from '../inspectorEmphasis.js';
import { inspectorLocateHandler } from '../inspectorLocate.js';

describe('inspectorLocateHandler', () => {
  /** A view that records what it was asked to mark and what to move to. */
  function wire(canMove = true) {
    const marks: Array<readonly number[]> = [];
    const revealed: number[] = [];
    const handle = inspectorLocateHandler(
      'calltree',
      new InspectorEmphasis(),
      (eventIndexes) => {
        marks.push(eventIndexes);
      },
      canMove
        ? (eventIndex) => {
            revealed.push(eventIndex);
            return Promise.resolve();
          }
        : undefined,
    );
    return { marks, revealed, handle };
  }

  it('leaves a report for another tab alone', () => {
    const { marks, revealed, handle } = wire();

    handle({ source: 'analysis', eventIndexes: [4], sticky: true });

    expect(marks).toEqual([]);
    expect(revealed).toEqual([]);
  });

  it('marks under the pointer without moving the view', () => {
    const { marks, revealed, handle } = wire();

    handle({ source: 'calltree', eventIndexes: [4, 5], sticky: false });

    expect(marks).toEqual([[4, 5]]);
    expect(revealed).toEqual([]);
  });

  it('marks a picked row and asks the view to move to its first occurrence', () => {
    const { marks, revealed, handle } = wire();

    handle({ source: 'calltree', eventIndexes: [4, 5], sticky: true });

    // The mark goes on first: a row the move renders lights itself from it.
    expect(marks).toEqual([[4, 5]]);
    expect(revealed).toEqual([4]);
  });

  it('clears the mark when the pick is dropped', () => {
    const { marks, revealed, handle } = wire();

    handle({ source: 'calltree', eventIndexes: [4], sticky: true });
    handle({ source: 'calltree', eventIndexes: [], sticky: true });

    expect(marks.at(-1)).toEqual([]);
    // Nothing to move to, so the view is left where the user put it.
    expect(revealed).toEqual([4]);
  });

  it('keeps the mark where the view cannot move', async () => {
    const marks: Array<readonly number[]> = [];
    const handle = inspectorLocateHandler(
      'calltree',
      new InspectorEmphasis(),
      (eventIndexes) => {
        marks.push(eventIndexes);
      },
      () => Promise.reject(new Error('no row for it')),
    );

    handle({ source: 'calltree', eventIndexes: [4], sticky: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(marks).toEqual([[4]]);
  });

  it('marks a picked row where the view cannot move to one', () => {
    const { marks, revealed, handle } = wire(false);

    handle({ source: 'calltree', eventIndexes: [4], sticky: true });

    expect(marks).toEqual([[4]]);
    expect(revealed).toEqual([]);
  });
});
