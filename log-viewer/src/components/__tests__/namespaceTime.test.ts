/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import type { FrameBudgetOptions } from '../../core/utility/FrameBudget.js';
import { cachedNamespaceSelfTimes, scopedNamespaceSelfTimes } from '../namespaceTime.js';
import { ev, log, roots, type FakeEvent } from './fixtures/logEvents.js';

const options: FrameBudgetOptions = { yieldSlice: () => Promise.resolve() };
// A fresh scope per call, so each case walks rather than answering from the memo.
const selfTimes = (events: FakeEvent[]) => scopedNamespaceSelfTimes({}, roots(events), options);

describe('namespace self times', () => {
  it('sums self time per namespace over the whole tree, largest first', async () => {
    const slices = await selfTimes([
      ev('default', 100, [ev('pkg', 500), ev('default', 50)]),
      ev('other', 200, [ev('pkg', 25)]),
    ]);

    expect(slices).toEqual([
      { namespace: 'pkg', selfTime: 525 },
      { namespace: 'other', selfTime: 200 },
      { namespace: 'default', selfTime: 150 },
    ]);
  });

  it('counts the roots themselves, so a frame scope includes its own self time', async () => {
    const frame = ev('pkg', 40, [ev('default', 10)]);

    expect(await selfTimes([frame])).toEqual([
      { namespace: 'pkg', selfTime: 40 },
      { namespace: 'default', selfTime: 10 },
    ]);
  });

  it('sums every occurrence of an aggregate as one scope', async () => {
    const first = ev('pkg', 30);
    const second = ev('pkg', 20, [ev('default', 5)]);

    expect(await selfTimes([first, second])).toEqual([
      { namespace: 'pkg', selfTime: 50 },
      { namespace: 'default', selfTime: 5 },
    ]);
  });

  it('counts a root inside another root once', async () => {
    const nested = ev('pkg', 20);
    const outer = ev('default', 10, [nested]);

    // Recursion puts two occurrences of one method on the same call chain.
    expect(await selfTimes([outer, nested])).toEqual([
      { namespace: 'pkg', selfTime: 20 },
      { namespace: 'default', selfTime: 10 },
    ]);
  });

  it('buckets a missing namespace under default and drops empty ones', async () => {
    const slices = await selfTimes([ev('', 40), ev('pkg', 0), ev('other', 10)]);

    expect(slices).toEqual([
      { namespace: 'default', selfTime: 40 },
      { namespace: 'other', selfTime: 10 },
    ]);
  });

  it('reports nothing for a scope with no recorded time', async () => {
    expect(await selfTimes([ev('pkg', 0)])).toEqual([]);
  });
});

describe('scopedNamespaceSelfTimes', () => {
  it('memoises per scope, returning the same array for the same log', async () => {
    const apexLog = log([ev('pkg', 100)]);

    expect(await scopedNamespaceSelfTimes(apexLog, apexLog.children, options)).toBe(
      await scopedNamespaceSelfTimes(apexLog, apexLog.children, options),
    );
  });

  it('memoises a frame apart from the log it is in', async () => {
    const frame = ev('pkg', 100);
    const apexLog = log([frame]);
    const whole = await scopedNamespaceSelfTimes(apexLog, apexLog.children, options);

    expect(await scopedNamespaceSelfTimes(frame, roots([frame]), options)).not.toBe(whole);
  });

  it('answers a walked scope synchronously, and an unwalked one not at all', async () => {
    const apexLog = log([ev('pkg', 100)]);

    expect(cachedNamespaceSelfTimes(apexLog)).toBeUndefined();
    const slices = await scopedNamespaceSelfTimes(apexLog, apexLog.children, options);
    expect(cachedNamespaceSelfTimes(apexLog)).toBe(slices);
  });
});
