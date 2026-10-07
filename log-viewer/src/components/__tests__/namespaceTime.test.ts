/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { indexTree } from '#test-helpers/apexLog.js';
import { namespaceColumn, namespaceSelfTimes } from '../namespaceTime.js';
import { namespaceEvent, log, type FakeEvent } from './fixtures/logEvents.js';

async function selfTimes(scope: FakeEvent[] | null, top: FakeEvent[] = scope ?? []) {
  const index = indexTree(log(top));
  const rows = scope?.map((event) => index.rowOf(event.eventIndex)) ?? null;
  return namespaceSelfTimes(index, await namespaceColumn(index), rows);
}

describe('namespace self times', () => {
  it('sums self time per namespace over the whole tree, largest first', async () => {
    const slices = await selfTimes(null, [
      namespaceEvent('default', 100, [namespaceEvent('pkg', 500), namespaceEvent('default', 50)]),
      namespaceEvent('other', 200, [namespaceEvent('pkg', 25)]),
    ]);

    expect(slices).toEqual([
      { namespace: 'pkg', selfTime: 525 },
      { namespace: 'other', selfTime: 200 },
      { namespace: 'default', selfTime: 150 },
    ]);
  });

  it('counts the roots themselves, so a frame scope includes its own self time', async () => {
    const frame = namespaceEvent('pkg', 40, [namespaceEvent('default', 10)]);

    expect(await selfTimes([frame], [namespaceEvent('other', 5, [frame])])).toEqual([
      { namespace: 'pkg', selfTime: 40 },
      { namespace: 'default', selfTime: 10 },
    ]);
  });

  it('sums every occurrence of an aggregate as one scope', async () => {
    const first = namespaceEvent('pkg', 30);
    const second = namespaceEvent('pkg', 20, [namespaceEvent('default', 5)]);

    expect(await selfTimes([second, first])).toEqual([
      { namespace: 'pkg', selfTime: 50 },
      { namespace: 'default', selfTime: 5 },
    ]);
  });

  it('counts a root inside another root once', async () => {
    const nested = namespaceEvent('pkg', 20);
    const outer = namespaceEvent('default', 10, [nested]);

    // Recursion puts two occurrences of one method on the same call chain.
    expect(await selfTimes([nested, outer], [outer])).toEqual([
      { namespace: 'pkg', selfTime: 20 },
      { namespace: 'default', selfTime: 10 },
    ]);
  });

  it('buckets a missing namespace under default and drops empty ones', async () => {
    const slices = await selfTimes([
      namespaceEvent('', 40),
      namespaceEvent('pkg', 0),
      namespaceEvent('other', 10),
    ]);

    expect(slices).toEqual([
      { namespace: 'default', selfTime: 40 },
      { namespace: 'other', selfTime: 10 },
    ]);
  });

  it('reports nothing for a scope with no recorded time', async () => {
    expect(await selfTimes([namespaceEvent('pkg', 0)])).toEqual([]);
  });

  it('reports nothing for an empty scope, unlike the whole log', async () => {
    const top = [namespaceEvent('pkg', 100)];

    expect(await selfTimes([], top)).toEqual([]);
    expect(await selfTimes(null, top)).toEqual([{ namespace: 'pkg', selfTime: 100 }]);
  });
});
