/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

import { runCalc as run } from '#test-helpers/calcs.js';
import { createEvent } from '#test-helpers/events.js';
import { sumDurationTotalForRootEvents } from '../../../analysis/services/CallStackSum.js';
import { knownMax, outermostSum } from '../calcs.js';

describe('outermostSum', () => {
  it('looks past ancestors that are not counted, and gives every calc on one list the same events', () => {
    const top = createEvent({ text: 'top', total: 20 });
    const middle = createEvent({ text: 'middle', total: 15, parent: top });
    const deep = createEvent({ text: 'deep', total: 5, parent: middle });
    const deeper = createEvent({ text: 'deeper', total: 2, parent: deep });
    const loose = createEvent({ text: 'loose', total: 1, parent: middle });
    const rows = [{ instances: [deeper, loose] }, { instances: [deep, top] }];
    expect(
      run(
        outermostSum((e) => e.duration.total),
        rows,
      ),
    ).toBe(20);
    const rest = [{ instances: [deeper, loose] }, { instances: [deep] }];
    const groups = rest.map((r) => r.instances);
    expect(
      run(
        outermostSum((e) => e.duration.total),
        rest,
      ),
    ).toBe(sumDurationTotalForRootEvents(groups));
    expect(
      run(
        outermostSum((e) => e.duration.self + 1),
        rest,
      ),
    ).toBe(2);
  });

  it('yields while it sums a long list', () => {
    const rows = [
      { instances: Array.from({ length: 3000 }, () => createEvent({ text: 'e', total: 1 })) },
    ];
    const out = outermostSum<{ instances: LogEvent[] }>((e) => e.duration.self).of(rows);
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
