/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { InspectorEmphasis } from '../inspectorEmphasis.js';
import { inspectorLocateHandler } from '../inspectorLocate.js';

describe('inspectorLocateHandler', () => {
  /** A view whose move settles only when the test says so, which is the window a
   *  later report has to arrive in. */
  function wire(move?: (eventIndex: number) => Promise<void>) {
    const marks: Array<readonly number[]> = [];
    const revealed: number[] = [];
    let settle: () => void = () => {};
    const emphasis = new InspectorEmphasis();
    const handle = inspectorLocateHandler(
      'calltree',
      emphasis,
      (eventIndexes) => marks.push(eventIndexes),
      move === undefined
        ? (eventIndex) => {
            revealed.push(eventIndex);
            return new Promise<void>((resolve) => {
              settle = resolve;
            });
          }
        : move,
    );
    return { marks, revealed, emphasis, finish: () => settle(), handle };
  }

  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it('moves to a picked row first, then marks', async () => {
    const { marks, revealed, finish, handle } = wire();

    handle({ source: 'calltree', eventIndexes: [4, 5], sticky: true });
    expect(revealed).toEqual([4]);
    // The mark waits: the move re-renders the rows it lands on.
    expect(marks).toEqual([]);

    finish();
    await settled();

    expect(marks).toEqual([[4, 5]]);
  });

  it('marks what a report arriving during the move replaced it with', async () => {
    const { marks, finish, handle } = wire();

    handle({ source: 'calltree', eventIndexes: [4], sticky: true });
    // The pointer reaches another row while the move it started is in flight.
    handle({ source: 'calltree', eventIndexes: [9], sticky: false });
    finish();
    await settled();

    // The move re-rendered the rows that hover had marked, so it goes on again.
    expect(marks.at(-1)).toEqual([9]);
  });

  it('clears the mark where the pick was dropped during the move', async () => {
    const { marks, finish, handle } = wire();

    handle({ source: 'calltree', eventIndexes: [4], sticky: true });
    handle({ source: 'calltree', eventIndexes: [], sticky: true });
    finish();
    await settled();

    expect(marks.at(-1)).toEqual([]);
  });

  it('clears the mark where the view cleared its own emphasis during the move', async () => {
    const { marks, emphasis, finish, handle } = wire();

    handle({ source: 'calltree', eventIndexes: [4], sticky: true });
    // Escape reaches the view as `selection:clear`, which never passes here.
    emphasis.pick([]);
    finish();
    await settled();

    expect(marks.at(-1)).toEqual([]);
  });

  it('marks even where the move fails, since the mark still says where the frames are', async () => {
    const { marks, handle } = wire(() => Promise.reject(new Error('no row for it')));

    handle({ source: 'calltree', eventIndexes: [4], sticky: true });
    await settled();

    expect(marks).toEqual([[4]]);
  });

  it('marks a picked row where the view cannot move to one', () => {
    const marks: Array<readonly number[]> = [];
    const handle = inspectorLocateHandler('calltree', new InspectorEmphasis(), (ids) =>
      marks.push(ids),
    );

    handle({ source: 'calltree', eventIndexes: [4], sticky: true });

    expect(marks).toEqual([[4]]);
  });
});
