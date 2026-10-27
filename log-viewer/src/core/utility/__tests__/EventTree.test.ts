/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { indexesOf, storeOf } from '#test-helpers/apexLog.js';
import { outermostIds } from '../EventTree.js';

const LOG =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1100)|METHOD_ENTRY|[2]|01p|ns.Inner.go()\n' +
  '09:18:22.6 (1200)|METHOD_EXIT|[2]|ns.Inner.go()\n' +
  '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n' +
  '09:18:22.6 (1400)|METHOD_ENTRY|[3]|01p|ns.Inner.go()\n' +
  '09:18:22.6 (1500)|METHOD_EXIT|[3]|ns.Inner.go()\n';

describe('outermostIds', () => {
  it('drops an id inside another one given, and keeps one outside', async () => {
    const { log } = await storeOf(LOG);
    const [outer] = indexesOf(log, 'ns.Outer.run()');
    const [nested, apart] = indexesOf(log, 'ns.Inner.go()');

    expect(outermostIds(log, [apart!, nested!, outer!])).toEqual([outer, apart]);
  });

  it('drops duplicates', async () => {
    const { log } = await storeOf(LOG);
    const [outer] = indexesOf(log, 'ns.Outer.run()');

    expect(outermostIds(log, [outer!, outer!])).toEqual([outer]);
  });

  // Ids in order skip the sort; few ids far apart are sorted, many close ones marked.
  // Every path must keep the same ids.
  it('keeps the same ids whether in order, close together or far apart', async () => {
    const debug = Array.from(
      { length: 100 },
      (_, i) => `09:18:22.6 (${2000 + i})|USER_DEBUG|[9]|DEBUG|line ${i}\n`,
    ).join('');
    const { log } = await storeOf(
      LOG +
        debug +
        '09:18:22.6 (3000)|METHOD_ENTRY|[4]|01p|ns.Last.run()\n' +
        '09:18:22.6 (3100)|METHOD_EXIT|[4]|ns.Last.run()\n',
    );
    const [outer] = indexesOf(log, 'ns.Outer.run()');
    const [nested, apart] = indexesOf(log, 'ns.Inner.go()');
    const [lastFrame] = indexesOf(log, 'ns.Last.run()');

    expect(outermostIds(log, [lastFrame!, nested!, outer!])).toEqual([outer, lastFrame]);
    expect(outermostIds(log, [apart!, nested!, outer!])).toEqual([outer, apart]);
    expect(outermostIds(log, [outer!, nested!, apart!, lastFrame!])).toEqual([
      outer,
      apart,
      lastFrame,
    ]);
  });

  it('gives nothing for nothing', async () => {
    const { log } = await storeOf(LOG);

    expect(outermostIds(log, [])).toEqual([]);
  });
});
