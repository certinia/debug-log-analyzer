/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from '@apexdevtools/apex-log-parser';
import { describe, expect, it } from '@jest/globals';

import { indexTree } from '#test-helpers/apexLog.js';
import { createEvent } from '#test-helpers/events.js';
import { idsBySelfTime, keySelfTimes, type KeySelfTimes } from '../keySelfTimes.js';
import { NO_ROW } from '../LogIndex.js';

function logOf(...children: LogEvent[]): ApexLog {
  return { children } as unknown as ApexLog;
}

async function timesOf(log: ApexLog): Promise<KeySelfTimes> {
  return keySelfTimes(indexTree(log));
}

/** One key's figures, by its text. */
function figuresOf(times: KeySelfTimes, text: string) {
  const id = times.keys.findIndex((key) => key.endsWith(`|${text}`));
  return {
    count: times.count[id],
    timedCount: times.timedCount[id],
    selfTime: times.selfTime[id],
    maxRow: times.maxRow[id],
    firstTimedRow: times.firstTimedRow[id],
    outerTotal: times.outerTotal[id],
  };
}

describe('keySelfTimes', () => {
  it('gives every row the id of its signature, in order of first row', async () => {
    const times = await timesOf(
      logOf(
        createEvent({ text: 'A' }),
        createEvent({ text: 'B' }),
        createEvent({ text: 'A', type: 'CODE_UNIT_STARTED' }),
        createEvent({ text: 'A' }),
      ),
    );

    expect(times.keys).toEqual([
      'METHOD_ENTRY|default|A',
      'METHOD_ENTRY|default|B',
      'CODE_UNIT_STARTED|default|A',
    ]);
    expect([...times.ids]).toEqual([0, 1, 2, 0]);
  });

  it('sums only the self time above zero, and counts every row', async () => {
    const times = await timesOf(
      logOf(
        createEvent({ text: 'A', self: 0 }),
        createEvent({ text: 'A', self: 30 }),
        createEvent({ text: 'A', self: -5 }),
        createEvent({ text: 'A', self: 10 }),
      ),
    );

    expect(figuresOf(times, 'A')).toMatchObject({
      count: 4,
      timedCount: 2,
      selfTime: 40,
      firstTimedRow: 1,
    });
  });

  it('points at the first row holding the most self time', async () => {
    const times = await timesOf(
      logOf(
        createEvent({ text: 'A', self: 10 }),
        createEvent({ text: 'A', self: 50 }),
        createEvent({ text: 'A', self: 50 }),
      ),
    );

    expect(figuresOf(times, 'A').maxRow).toBe(1);
  });

  it('leaves a signature the log never timed without a timed row', async () => {
    const times = await timesOf(logOf(createEvent({ text: 'A', self: 0, total: 20 })));

    expect(figuresOf(times, 'A')).toMatchObject({ selfTime: 0, firstTimedRow: NO_ROW });
  });

  it('counts the total of the outermost rows only, so recursion counts once', async () => {
    const outer = createEvent({ text: 'Recurse', total: 300 });
    createEvent({ text: 'Recurse', total: 260, parent: outer });
    const later = createEvent({ text: 'Recurse', total: 100 });

    const times = await timesOf(logOf(outer, later));

    expect(figuresOf(times, 'Recurse')).toMatchObject({ count: 3, outerTotal: 400 });
  });

  it('counts a nested row once its outer row has ended', async () => {
    const first = createEvent({ text: 'Wrap', total: 50 });
    const other = createEvent({ text: 'Other', total: 40 });
    createEvent({ text: 'Wrap', total: 30, parent: other });

    const times = await timesOf(logOf(first, other));

    expect(figuresOf(times, 'Wrap').outerTotal).toBe(80);
  });
});

describe('idsBySelfTime', () => {
  it('ranks the timed signatures, the most self time first', async () => {
    const times = await timesOf(
      logOf(
        createEvent({ text: 'Small', self: 5 }),
        createEvent({ text: 'Untimed', self: 0 }),
        createEvent({ text: 'Big', self: 50 }),
      ),
    );

    expect(idsBySelfTime(times).map((id) => times.keys[id])).toEqual([
      'METHOD_ENTRY|default|Big',
      'METHOD_ENTRY|default|Small',
    ]);
  });

  it('breaks a tie by which signature the log timed first', async () => {
    const times = await timesOf(
      logOf(
        createEvent({ text: 'B', self: 0 }),
        createEvent({ text: 'A', self: 10 }),
        createEvent({ text: 'B', self: 10 }),
      ),
    );

    // B ran first, but A was timed first.
    expect(idsBySelfTime(times).map((id) => times.keys[id])).toEqual([
      'METHOD_ENTRY|default|A',
      'METHOD_ENTRY|default|B',
    ]);
  });
});
