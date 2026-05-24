/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { parse } from 'apex-log-parser';

import { findEventByEventIndex } from '../core/utility/EventSearch.js';

describe('EventSearch', () => {
  it('finds the exact event by eventIndex when timestamps are duplicated', () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
      '09:18:22.6 (7000000)|METHOD_ENTRY|[1]|01p|ns.ClassOne.first()\n' +
      '09:18:22.6 (7100000)|METHOD_EXIT|[1]|ns.ClassOne.first()\n' +
      '09:18:22.6 (7000000)|METHOD_ENTRY|[2]|01p|ns.ClassTwo.second()\n' +
      '09:18:22.6 (7200000)|METHOD_EXIT|[2]|ns.ClassTwo.second()\n' +
      '09:18:22.6 (7300000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
      '09:18:22.6 (7400000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);
    const target = apexLog.eventsById.find((evt) => evt.text === 'ns.ClassTwo.second()');

    expect(target).toBeDefined();
    const result = findEventByEventIndex(apexLog, target!.eventIndex);

    expect(result?.event.text).toBe('ns.ClassTwo.second()');
    expect(result?.event.eventIndex).toBe(target!.eventIndex);
  });
});
