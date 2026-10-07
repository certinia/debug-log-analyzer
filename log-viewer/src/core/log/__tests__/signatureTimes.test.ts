/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import { describe, expect, it } from '@jest/globals';

import { indexTree } from '#test-helpers/apexLog.js';
import { createEvent } from '#test-helpers/events.js';
import { LogStore } from '../LogStore.js';
import { signatureTimes, type SignatureTimes } from '../signatureTimes.js';

function timesOf(...children: LogEvent[]): Promise<SignatureTimes> {
  const log = { children } as unknown as ApexLog;
  indexTree(log);
  return new LogStore(log).derive(signatureTimes);
}

const named = (times: SignatureTimes, text: string) =>
  times.ranked.find((signature) => signature.text === text);

describe('signatureTimes', () => {
  it('keeps the same text under another type or namespace apart', async () => {
    const times = await timesOf(
      createEvent({ text: 'A', self: 1 }),
      createEvent({ text: 'A', self: 2, type: 'CODE_UNIT_STARTED' }),
      createEvent({ text: 'A', self: 3, namespace: 'pkg' }),
      createEvent({ text: 'A', self: 4 }),
    );

    expect(times.ranked.map(({ selfTime }) => selfTime)).toEqual([5, 3, 2]);
  });

  it('sums only the self time above zero, and counts every call', async () => {
    const times = await timesOf(
      createEvent({ text: 'A', self: 0 }),
      createEvent({ text: 'A', self: 30 }),
      createEvent({ text: 'A', self: -5 }),
      createEvent({ text: 'A', self: 10 }),
    );

    expect(named(times, 'A')).toMatchObject({ count: 4, timedCount: 2, selfTime: 40 });
    expect(times.totalSelf).toBe(40);
  });

  it('points at the first call holding the most self time', async () => {
    const times = await timesOf(
      createEvent({ text: 'A', self: 10, category: 'Apex' }),
      createEvent({ text: 'A', self: 50, category: 'SOQL' }),
      createEvent({ text: 'A', self: 50, category: 'DML' }),
    );

    // The root takes eventIndex 0.
    expect(named(times, 'A')).toMatchObject({ eventIndex: 2, maxSelf: 50, category: 'SOQL' });
  });

  it('leaves out a signature the log never timed', async () => {
    const times = await timesOf(createEvent({ text: 'A', self: 0, total: 20 }));

    expect(times.ranked).toEqual([]);
    expect(times.totalSelf).toBe(0);
  });

  it('counts the total of the outermost calls only, so recursion counts once', async () => {
    const outer = createEvent({ text: 'Recurse', self: 40, total: 300 });
    createEvent({ text: 'Recurse', self: 260, total: 260, parent: outer });
    const later = createEvent({ text: 'Recurse', self: 100, total: 100 });

    const times = await timesOf(outer, later);

    expect(named(times, 'Recurse')).toMatchObject({ count: 3, outerTotal: 400 });
  });

  it('counts a nested call once its outer call has ended', async () => {
    const first = createEvent({ text: 'Wrap', self: 50, total: 50 });
    const other = createEvent({ text: 'Other', self: 10, total: 40 });
    createEvent({ text: 'Wrap', self: 30, total: 30, parent: other });

    const times = await timesOf(first, other);

    expect(named(times, 'Wrap')?.outerTotal).toBe(80);
  });

  it('ranks by self time, a tie to the signature timed first', async () => {
    const times = await timesOf(
      createEvent({ text: 'B', self: 0 }),
      createEvent({ text: 'Small', self: 5 }),
      createEvent({ text: 'A', self: 10 }),
      createEvent({ text: 'B', self: 10 }),
    );

    // B ran first, but A was timed first.
    expect(times.ranked.map(({ text }) => text)).toEqual(['A', 'B', 'Small']);
  });

  it("gives each signature's self times, ascending, in the order asked", async () => {
    const times = await timesOf(
      createEvent({ text: 'A', self: 30 }),
      createEvent({ text: 'B', self: 7 }),
      createEvent({ text: 'A', self: 0 }),
      createEvent({ text: 'A', self: 10 }),
    );
    const [a, b] = [named(times, 'A')!, named(times, 'B')!]; // both timed above

    expect(times.valuesOf([b, a]).map((values) => [...values])).toEqual([[7], [10, 30]]);
  });

  it('gives no values for a signature from another log', async () => {
    const times = await timesOf(createEvent({ text: 'A', self: 30 }));
    const other = await timesOf(createEvent({ text: 'A', self: 5 }));

    expect(times.valuesOf(other.ranked).map((values) => [...values])).toEqual([[]]);
  });
});
