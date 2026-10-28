/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { frameLines, idOf, storeOf } from '#test-helpers/apexLog.js';
import { runCalc as run } from '#test-helpers/calcs.js';
import { knownMax, outermostSum } from '../calcs.js';

describe('outermostSum', () => {
  it('looks past ancestors that are not counted, and gives every calc on one list the same events', async () => {
    // Totals: top 21, middle 16, deep 5, deeper 2, loose 1.
    const { log } = await storeOf(
      frameLines([
        {
          text: 'top',
          self: 5,
          children: [
            {
              text: 'middle',
              self: 10,
              children: [
                { text: 'deep', self: 3, children: [{ text: 'deeper', self: 2 }] },
                { text: 'loose', self: 1 },
              ],
            },
          ],
        },
      ]),
    );
    const id = (text: string): number => idOf(log, text);
    const total = (eventId: number): number => log.columns.durationTotal[eventId] ?? 0;
    const rows = [
      { instances: [id('deeper'), id('loose')] },
      { instances: [id('deep'), id('top')] },
    ];
    expect(run(outermostSum(log, total), rows)).toBe(21);
    const rest = [{ instances: [id('deeper'), id('loose')] }, { instances: [id('deep')] }];
    expect(run(outermostSum(log, total), rest)).toBe(6);
    expect(
      run(
        outermostSum(log, () => 1),
        rest,
      ),
    ).toBe(2);
  });

  it('yields while it sums a long list', async () => {
    const { log } = await storeOf(
      frameLines(Array.from({ length: 3000 }, () => ({ text: 'e', self: 1 }))),
    );
    const ids: number[] = [];
    for (let eventId = 1; eventId <= log.eventCount; eventId++) {
      if (log.columns.text.at(eventId) === 'e') {
        ids.push(eventId);
      }
    }
    const out = outermostSum<{ instances: number[] }>(log, () => 1).of([{ instances: ids }]);
    if (typeof out === 'number') {
      throw new Error('expected a generator');
    }
    let yields = 0;
    while (!out.next().done) {
      yields++;
    }
    expect(yields).toBeGreaterThan(1);
  });
});

describe('knownMax', () => {
  const highest = knownMax<{ v: number | null }>((r) => r.v);

  it('is the highest known value', () => {
    expect(run(highest, [{ v: null }, { v: 5 }, { v: 3 }])).toBe(5);
  });

  it('is NaN, not 0, where no row has a value', () => {
    expect(run(highest, [{ v: null }])).toBeNaN();
    expect(run(highest, [])).toBeNaN();
  });
});
