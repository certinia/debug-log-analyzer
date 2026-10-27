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

  it('gives nothing for nothing', async () => {
    const { log } = await storeOf(LOG);

    expect(outermostIds(log, [])).toEqual([]);
  });
});
