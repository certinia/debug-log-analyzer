/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { type ApexLog, parse } from 'apex-log-parser';

import {
  aggregateVariablesFor,
  cachedAggregateVariables,
  MAX_VALUES_PER_NAME,
} from '../aggregateVariables.js';
import { variableIndexFor } from '../frameVariables.js';
import { logStoreFor, type LogStore } from '../LogStore.js';

const SETTINGS = '64.0 APEX_CODE,FINEST;APEX_PROFILING,NONE;DB,NONE\n';

/** Resolves at once, so a test measures the walk rather than the frames it
 *  would leave to the next paint. */
const yieldSlice = (): Promise<void> => Promise.resolve();

function storeOf(body: string): { log: ApexLog; store: LogStore } {
  const log = parse(
    SETTINGS +
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
      body +
      '09:18:22.6 (900000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
      '09:18:22.6 (901000)|EXECUTION_FINISHED\n',
  );
  return { log, store: logStoreFor(log) };
}

/** Every frame whose log text is `text`, in log order. Frames only: a
 *  METHOD_EXIT carries the same text as the entry it closes. */
function indexesOf(log: ApexLog, text: string): number[] {
  return log.eventsById
    .filter((event) => event.isParent && event.text === text)
    .map((event) => event.eventIndex);
}

/** One call of `ns.Svc.run()` writing `retry` and `accountId`. */
function call(at: number, retry: string, accountId: string): string {
  const t = (offset: number): string => `09:18:22.6 (${at + offset})`;
  return (
    `${t(0)}|METHOD_ENTRY|[1]|01p|ns.Svc.run()\n` +
    `${t(10)}|VARIABLE_SCOPE_BEGIN|[2]|retry|Boolean|true|false\n` +
    `${t(20)}|VARIABLE_ASSIGNMENT|[2]|retry|${retry}\n` +
    `${t(30)}|VARIABLE_SCOPE_BEGIN|[3]|accountId|Id|true|false\n` +
    `${t(40)}|VARIABLE_ASSIGNMENT|[3]|accountId|"${accountId}"\n` +
    `${t(50)}|VARIABLE_ASSIGNMENT|[4]|batchSize|200\n` +
    `${t(60)}|METHOD_EXIT|[1]|ns.Svc.run()\n`
  );
}

const CALLS =
  call(1000, 'true', '001A') + call(2000, 'false', '001B') + call(3000, 'false', '001C');

/** The comparison of every `ns.Svc.run()` call, with the statics index built. */
async function compare(body: string, text = 'ns.Svc.run()') {
  const { log, store } = storeOf(body);
  const index = await variableIndexFor(log, { yieldSlice });
  const frames = indexesOf(log, text);
  const spread = await aggregateVariablesFor(store, frames, index, { yieldSlice });
  return { log, store, index, frames, spread };
}

describe('aggregateVariablesFor', () => {
  it('reads every call and groups its locals by name', async () => {
    const { spread } = await compare(CALLS);

    expect(spread?.frames).toBe(3);
    expect(spread?.locals.map((row) => row.name)).toEqual(['accountId', 'retry', 'batchSize']);
  });

  it('counts the calls that held each distinct value, most calls first', async () => {
    const { spread } = await compare(CALLS);

    const retry = spread?.locals.find((row) => row.name === 'retry');
    expect(retry?.values.map((value) => [value.text, value.calls])).toEqual([
      ['false', 2],
      ['true', 1],
    ]);
    expect(retry?.calls).toBe(3);
  });

  // Which input varied is the reading a merged row carries, so the names that
  // varied lead; a constant reads as it does for a single frame.
  it('leads with the names that varied and trails with the constants', async () => {
    const { spread } = await compare(CALLS);

    expect(spread?.locals.map((row) => [row.name, row.values.length])).toEqual([
      ['accountId', 3],
      ['retry', 2],
      ['batchSize', 1],
    ]);
  });

  // The mark is what a value row points at, so it names every call, not one.
  it('names the calls that held a value', async () => {
    const { log, spread } = await compare(CALLS);
    const calls = indexesOf(log, 'ns.Svc.run()');

    const retry = spread?.locals.find((row) => row.name === 'retry');
    expect(retry?.values.find((value) => value.text === 'false')?.at).toEqual([calls[1], calls[2]]);
    expect(retry?.values.find((value) => value.text === 'true')?.at).toEqual([calls[0]]);
  });

  // Counts alone mislead: an unbroken run is a state the calls were in, where
  // the same count scattered is a value that came and went.
  it('counts the runs of consecutive calls that held each value', async () => {
    const { spread } = await compare(CALLS);
    const back = await compare(
      call(1000, 'true', '001A') + call(2000, 'false', '001B') + call(3000, 'true', '001C'),
    );

    expect(
      spread?.locals.find((row) => row.name === 'retry')?.values.map((value) => value.runs),
    ).toEqual([1, 1]);
    // `true` was held by the first and last call, with `false` between them.
    expect(
      back.spread?.locals.find((row) => row.name === 'retry')?.values.map((value) => value.runs),
    ).toEqual([2, 1]);
  });

  it('stops naming calls for the mark past its own cap', async () => {
    let body = '';
    for (let at = 0; at < 210; at++) {
      body += call(1000 + at * 100, 'true', '001A');
    }

    const { spread } = await compare(body);

    const retry = spread?.locals.find((row) => row.name === 'retry');
    // Every call held it, and the mark holds the first 200 of them.
    expect(retry?.values[0]?.calls).toBe(210);
    expect(retry?.values[0]?.at).toHaveLength(200);
    expect(retry?.values[0]?.runs).toBe(1);
  });

  // In scope at its default, with no value the log recorded.
  it('counts the calls that declared a name and never wrote it', async () => {
    const declared =
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Svc.run()\n' +
      '09:18:22.6 (1010)|VARIABLE_SCOPE_BEGIN|[2]|held|Integer|true|false\n' +
      '09:18:22.6 (1020)|VARIABLE_ASSIGNMENT|[2]|held|7\n' +
      '09:18:22.6 (1030)|METHOD_EXIT|[1]|ns.Svc.run()\n' +
      '09:18:22.6 (2000)|METHOD_ENTRY|[1]|01p|ns.Svc.run()\n' +
      '09:18:22.6 (2010)|VARIABLE_SCOPE_BEGIN|[2]|held|Integer|true|false\n' +
      '09:18:22.6 (2030)|METHOD_EXIT|[1]|ns.Svc.run()\n';

    const { spread } = await compare(declared);

    const held = spread?.locals.find((row) => row.name === 'held');
    expect(held).toMatchObject({ calls: 2, unassigned: 1, declaredType: 'Integer' });
    expect(held?.values.map((value) => value.text)).toEqual(['7']);
  });

  // Every value is listed, since a value per call is the reading that says a
  // name is an input; the cap only bounds a pathological selection.
  it('stops holding values past the cap and says it did', async () => {
    let body = '';
    for (let at = 0; at < MAX_VALUES_PER_NAME + 20; at++) {
      body += call(1000 + at * 100, 'true', `001${at}`);
    }

    const { spread } = await compare(body);

    const accountId = spread?.locals.find((row) => row.name === 'accountId');
    expect(accountId?.values).toHaveLength(MAX_VALUES_PER_NAME);
    expect(accountId?.capped).toBe(true);
    expect(accountId?.calls).toBe(MAX_VALUES_PER_NAME + 20);
    // Under the cap, so its count is the whole truth.
    expect(spread?.locals.find((row) => row.name === 'retry')?.capped).toBe(false);
  });

  // A recursive frame's nested call is its own call with its own values, so
  // dropping it the way an outermost-events dedupe would undercounts the spread.
  it('reads a nested call of the same frame as a call of its own', async () => {
    const recursive =
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Svc.run()\n' +
      '09:18:22.6 (1010)|VARIABLE_ASSIGNMENT|[2]|depth|1\n' +
      '09:18:22.6 (1020)|METHOD_ENTRY|[1]|01p|ns.Svc.run()\n' +
      '09:18:22.6 (1030)|VARIABLE_ASSIGNMENT|[2]|depth|2\n' +
      '09:18:22.6 (1040)|METHOD_EXIT|[1]|ns.Svc.run()\n' +
      '09:18:22.6 (1050)|METHOD_EXIT|[1]|ns.Svc.run()\n';

    const { spread } = await compare(recursive);

    expect(spread?.frames).toBe(2);
    expect(
      spread?.locals.find((row) => row.name === 'depth')?.values.map((value) => value.text),
    ).toEqual(['1', '2']);
  });

  it('returns null for an abandoned walk, and never memoises it', async () => {
    const { log, store } = storeOf(CALLS);
    const index = await variableIndexFor(log, { yieldSlice });
    const frames = indexesOf(log, 'ns.Svc.run()');
    // Only a spent slice yields, and only a yield reads the signal.
    const clock = jest.spyOn(performance, 'now');
    let time = 0;
    clock.mockImplementation(() => (time += 100));
    try {
      const spread = await aggregateVariablesFor(store, frames, index, {
        yieldSlice,
        signal: AbortSignal.abort(),
      });

      expect(spread).toBeNull();
      expect(cachedAggregateVariables(frames)).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });

  it('answers a walked selection from the memo, so nothing walks twice', async () => {
    const { store, index, frames, spread } = await compare(CALLS);

    expect(cachedAggregateVariables(frames)).toBe(spread);
    expect(await aggregateVariablesFor(store, frames, index, { yieldSlice })).toBe(spread);
  });
});

describe('aggregateVariablesFor on this', () => {
  /** One call of `ns.Svc.run()` on the object at `address`. */
  function onObject(at: number, address: string, name: string): string {
    const t = (offset: number): string => `09:18:22.6 (${at + offset})`;
    return (
      `${t(0)}|METHOD_ENTRY|[1]|01p|ns.Svc.run()\n` +
      `${t(10)}|VARIABLE_SCOPE_BEGIN|[2]|this|ns.Svc|true|false\n` +
      `${t(20)}|VARIABLE_ASSIGNMENT|[2]|this|{}|${address}\n` +
      `${t(30)}|VARIABLE_ASSIGNMENT|[3]|this.name|"${name}"|${address}\n` +
      `${t(40)}|METHOD_EXIT|[1]|ns.Svc.run()\n`
    );
  }

  it('spreads the fields and counts the objects the calls ran on', async () => {
    const { spread } = await compare(onObject(1000, '0xaaa', 'A') + onObject(2000, '0xbbb', 'B'));

    expect(spread?.thisType).toBe('ns.Svc');
    expect(spread?.objects).toBe(2);
    expect(spread?.fields.map((row) => [row.name, row.values.length])).toEqual([['name', 2]]);
  });

  it('names no class where the calls did not agree on one', async () => {
    const { log, store } = storeOf(
      onObject(1000, '0xaaa', 'A') +
        '09:18:22.6 (2000)|METHOD_ENTRY|[1]|01p|ns.Other.run()\n' +
        '09:18:22.6 (2010)|VARIABLE_ASSIGNMENT|[2]|count|1\n' +
        '09:18:22.6 (2020)|METHOD_EXIT|[1]|ns.Other.run()\n',
    );
    const index = await variableIndexFor(log, { yieldSlice });
    const frames = [...indexesOf(log, 'ns.Svc.run()'), ...indexesOf(log, 'ns.Other.run()')];

    const spread = await aggregateVariablesFor(store, frames, index, { yieldSlice });

    expect(spread?.frames).toBe(2);
    expect(spread?.thisType).toBeNull();
  });
});
