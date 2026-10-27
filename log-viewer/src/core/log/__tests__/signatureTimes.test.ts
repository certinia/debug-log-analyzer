/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { type FrameSpec, frameLines, storeOf } from '#test-helpers/apexLog.js';
import { signatureTimes, type SignatureTimes } from '../signatureTimes.js';

async function timesOf(...frames: FrameSpec[]): Promise<SignatureTimes> {
  return (await storeOf(frameLines(frames))).store.derive(signatureTimes);
}

const named = (times: SignatureTimes, text: string) =>
  times.ranked.find((signature) => signature.text === text);

/** The ranked signatures a test laid out, leaving out the execution and code unit the helper wraps them in. */
const ownRanked = (times: SignatureTimes) =>
  times.ranked.filter(({ text }) => text !== 'EXECUTION_STARTED' && text !== 'apex://pkg.Entry');

describe('signatureTimes', () => {
  it('keeps the same text under another type or namespace apart', async () => {
    const times = await timesOf(
      { text: 'A', self: 1 },
      { text: 'A', self: 2, type: 'CODE_UNIT_STARTED' },
      // A code unit named for a namespace gives its methods that namespace.
      { text: 'other.Wrap', type: 'CODE_UNIT_STARTED', children: [{ text: 'A', self: 3 }] },
      { text: 'A', self: 4 },
    );

    const a = times.ranked.filter(({ text }) => text === 'A');
    expect(a.map(({ selfTime }) => selfTime)).toEqual([5, 3, 2]);
  });

  it('sums only the self time above zero, and counts every call', async () => {
    const times = await timesOf(
      { text: 'A', self: 0 },
      { text: 'A', self: 30 },
      { text: 'A', self: 10 },
    );

    expect(named(times, 'A')).toMatchObject({ count: 3, timedCount: 2, selfTime: 40 });
    expect(times.totalSelf).toBe(times.ranked.reduce((sum, { selfTime }) => sum + selfTime, 0));
  });

  it('points at the first call holding the most self time', async () => {
    const { store } = await storeOf(
      frameLines([
        { text: 'A', self: 10 },
        { text: 'A', self: 50 },
        { text: 'A', self: 50 },
      ]),
    );
    const times = await store.derive(signatureTimes);
    const second = store.log.ofType('METHOD_ENTRY')[1]!;

    expect(named(times, 'A')).toMatchObject({
      eventIndex: second.id,
      maxSelf: 50,
      category: 'Apex',
    });
  });

  it('leaves out a signature the log never timed', async () => {
    const times = await timesOf({ text: 'A', self: 0 });

    expect(named(times, 'A')).toBeUndefined();
  });

  it('counts the total of the outermost calls only, so recursion counts once', async () => {
    const times = await timesOf(
      { text: 'Recurse', self: 40, children: [{ text: 'Recurse', self: 260 }] },
      { text: 'Recurse', self: 100 },
    );

    expect(named(times, 'Recurse')).toMatchObject({ count: 3, outerTotal: 400 });
  });

  it('counts a nested call once its outer call has ended', async () => {
    const times = await timesOf(
      { text: 'Wrap', self: 50 },
      { text: 'Other', self: 10, children: [{ text: 'Wrap', self: 30 }] },
    );

    expect(named(times, 'Wrap')?.outerTotal).toBe(80);
  });

  it('ranks by self time, a tie to the signature timed first', async () => {
    const times = await timesOf(
      { text: 'B', self: 0 },
      { text: 'Small', self: 5 },
      { text: 'A', self: 10 },
      { text: 'B', self: 10 },
    );

    // B ran first, but A was timed first.
    expect(ownRanked(times).map(({ text }) => text)).toEqual(['A', 'B', 'Small']);
  });

  it("gives each signature's self times, ascending, in the order asked", async () => {
    const times = await timesOf(
      { text: 'A', self: 30 },
      { text: 'B', self: 7 },
      { text: 'A', self: 0 },
      { text: 'A', self: 10 },
    );
    const [a, b] = [named(times, 'A')!, named(times, 'B')!]; // both timed above

    expect(times.valuesOf([b, a]).map((values) => [...values])).toEqual([[7], [10, 30]]);
  });

  it('gives no values for a signature from another log', async () => {
    const times = await timesOf({ text: 'A', self: 30 });
    const other = await timesOf({ text: 'A', self: 5 });

    expect(times.valuesOf([named(other, 'A')!]).map((values) => [...values])).toEqual([[]]);
  });
});
