/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from 'vitest';

import { indexesOf, storeOf } from '#test-helpers/apexLog.js';
import { findEventByEventIndex } from '../EventSearch.js';

describe('EventSearch', () => {
  it('finds the exact event by eventIndex when timestamps are duplicated', () => {
    const { log } = storeOf(
      '09:18:22.6 (7000000)|METHOD_ENTRY|[1]|01p|ns.ClassOne.first()\n' +
        '09:18:22.6 (7100000)|METHOD_EXIT|[1]|ns.ClassOne.first()\n' +
        '09:18:22.6 (7000000)|METHOD_ENTRY|[2]|01p|ns.ClassTwo.second()\n' +
        '09:18:22.6 (7200000)|METHOD_EXIT|[2]|ns.ClassTwo.second()\n',
    );
    const [target] = indexesOf(log, 'ns.ClassTwo.second()');

    const result = findEventByEventIndex(log, target!);

    expect(result?.event.text).toBe('ns.ClassTwo.second()');
    expect(result?.event.eventIndex).toBe(target);
  });
});
