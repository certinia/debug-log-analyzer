/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import type { ApexLog, DebugLevels, LogEvent } from '@apexdevtools/apex-log-parser';

import { indexOf, storeOf } from '#test-helpers/apexLog.js';
import { filterByLevels, isHidden, LevelFilterBuilder, sameLevels } from '../levelFilter.js';
import { eventByEventIndex, findEventByEventIndex } from '../../utility/EventSearch.js';
import { logStoreFor } from '../LogStore.js';

const SETTINGS = '64.0 APEX_CODE,FINEST;APEX_PROFILING,NONE;DB,FINEST;SYSTEM,FINE\n';

const BODY =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (2000)|USER_DEBUG|[2]|DEBUG|hello\n' +
  '09:18:22.6 (3000)|METHOD_ENTRY|[3]|01p|ns.Inner.go()\n' +
  '09:18:22.6 (4000)|SOQL_EXECUTE_BEGIN|[4]|Aggregations:0|SELECT Id FROM Account\n' +
  '09:18:22.6 (5000)|SOQL_EXECUTE_END|[4]|Rows:2\n' +
  '09:18:22.6 (5500)|EXCEPTION_THROWN|[5]|System.NullPointerException: boom\n' +
  '09:18:22.6 (6000)|METHOD_EXIT|[3]|ns.Inner.go()\n' +
  '09:18:22.6 (7000)|USER_DEBUG|[8]|DEBUG|bye\n' +
  '09:18:22.6 (8000)|METHOD_EXIT|[1]|ns.Outer.run()\n';

const yieldSlice = (): Promise<void> => Promise.resolve();

function logOf(): ApexLog {
  return storeOf(BODY, SETTINGS).log;
}

/** More events than one step reads, so a build takes several. */
function longLog(): ApexLog {
  const debug = Array.from(
    { length: 300 },
    (_, i) => `09:18:22.6 (${2000 + i})|USER_DEBUG|[2]|DEBUG|line ${i}\n`,
  ).join('');
  return storeOf(
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
      debug +
      '09:18:22.6 (9000)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    SETTINGS,
  ).log;
}

function build(log: ApexLog, chosen: DebugLevels): ApexLog {
  const builder = new LevelFilterBuilder(log, chosen);
  while (!builder.step(Number.MAX_SAFE_INTEGER)) {
    // one step reads the whole tree
  }
  return builder.finish();
}

function walk(root: LogEvent): LogEvent[] {
  return root.children.flatMap((child) => [child, ...walk(child)]);
}

function codeUnit(log: ApexLog): LogEvent {
  const found = walk(log).find((event) => event.type === 'CODE_UNIT_STARTED');
  if (!found) {
    throw new Error('no code unit');
  }
  return found;
}

function selfSum(log: ApexLog, key: 'duration' | 'soqlCount'): number {
  return [log, ...walk(log)].reduce((sum, event) => sum + event[key].self, 0);
}

describe('levelFilter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the log itself when no level is lowered', async () => {
    const log = logOf();

    expect(await filterByLevels(log, { ...log.debugLevels }, { yieldSlice })).toBe(log);
  });

  it('returns the log itself when a lowered level hides nothing', async () => {
    const log = logOf();

    expect(await filterByLevels(log, { apexCode: 'FINER' }, { yieldSlice })).toBe(log);
  });

  it('hoists kept events to the nearest kept ancestor, in log order', () => {
    const filtered = build(logOf(), { apexCode: 'DEBUG' });

    expect(codeUnit(filtered).children.map((event) => event.type)).toEqual([
      'USER_DEBUG',
      'SOQL_EXECUTE_BEGIN',
      'EXCEPTION_THROWN',
      'USER_DEBUG',
    ]);
    expect(walk(filtered).every((event) => event.parent?.children.includes(event))).toBe(true);
  });

  it('hides a USER_DEBUG line by the level it was written at', () => {
    const log = storeOf(
      '09:18:22.6 (1000)|USER_DEBUG|[1]|ERROR|kept\n' +
        '09:18:22.6 (2000)|USER_DEBUG|[2]|FINEST|hidden\n',
      SETTINGS,
    ).log;

    const filtered = build(log, { apexCode: 'INFO' });

    expect(
      walk(filtered)
        .filter((event) => event.type === 'USER_DEBUG')
        .map((event) => event.text),
    ).toEqual(['ERROR | kept']);
  });

  it.each([
    ['keeps', 'INFO', ['SOQL_EXECUTE_BEGIN', 'SOQL_EXECUTE_EXPLAIN']],
    ['hides', 'NONE', []],
  ] as const)('%s a query plan with its query, at DB %s', (_verb, database, kept) => {
    const log = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (2000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account\n' +
        '09:18:22.6 (2100)|SOQL_EXECUTE_EXPLAIN|[2]|Index on Account : [Id], cardinality: 1, sobjectCardinality: 10, relativeCost 0.1\n' +
        '09:18:22.6 (3000)|SOQL_EXECUTE_END|[2]|Rows:1\n' +
        '09:18:22.6 (4000)|METHOD_EXIT|[1]|ns.Outer.run()\n',
      SETTINGS,
    ).log;

    const filtered = build(log, { apexCode: 'DEBUG', database });

    expect(
      walk(filtered)
        .map((event) => event.type)
        .filter((type) => type?.startsWith('SOQL')),
    ).toEqual(kept);
  });

  it('keeps namespace limit usage with its limit block, and only there', () => {
    const log = storeOf(
      '09:18:22.6 (1000)|TESTING_LIMITS\n' +
        '09:18:22.6 (1100)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 2 out of 100\n' +
        '09:18:22.6 (3000)|CUMULATIVE_LIMIT_USAGE\n' +
        '09:18:22.6 (3100)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 1 out of 100\n' +
        '09:18:22.6 (3200)|CUMULATIVE_LIMIT_USAGE_END\n',
      '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST;DB,FINEST\n',
    ).log;

    const filtered = build(log, { apexProfiling: 'INFO' });

    expect(
      walk(filtered)
        .filter((event) => event.type === 'LIMIT_USAGE_FOR_NS')
        .map((event) => event.parent?.type),
    ).toEqual(['CUMULATIVE_LIMIT_USAGE']);
  });

  it('keeps the self sum of the tree', () => {
    const log = logOf();

    const filtered = build(log, { apexCode: 'DEBUG', database: 'ERROR' });

    expect(selfSum(filtered, 'duration')).toBe(selfSum(log, 'duration'));
    expect(selfSum(filtered, 'soqlCount')).toBe(selfSum(log, 'soqlCount'));
  });

  it('folds a hidden statement count into its parent', () => {
    const log = logOf();
    const inner = log.eventsById[indexOf(log, 'ns.Inner.go()')]!;

    const filtered = build(log, { database: 'ERROR' });
    const filteredInner = filtered.eventsById[inner.eventIndex]!;

    expect(filteredInner.soqlCount.self).toBe(1);
    expect(filteredInner.soqlCount.total).toBe(inner.soqlCount.total);
    expect(filteredInner.children.some((event) => event.type === 'SOQL_EXECUTE_BEGIN')).toBe(false);
  });

  it('does not change the original log', () => {
    const log = logOf();
    const before = { duration: selfSum(log, 'duration'), events: walk(log).length };

    build(log, { apexCode: 'NONE', database: 'NONE' });

    expect({ duration: selfSum(log, 'duration'), events: walk(log).length }).toEqual(before);
  });

  it('finds no event at a hidden index, and the log itself at its own', () => {
    const log = logOf();
    const filtered = build(log, { apexCode: 'DEBUG' });
    const inner = indexOf(log, 'ns.Inner.go()');

    expect(logStoreFor(filtered).eventByIndex(inner)).toBeNull();
    expect(findEventByEventIndex(filtered, inner)).toBeNull();
    expect(logStoreFor(filtered).stackByEventIndex(inner)).toEqual([]);
    expect(eventByEventIndex(filtered, filtered.eventIndex)).toBe(filtered);
  });

  it('lists every kept event and none that is hidden', () => {
    const log = logOf();
    const filtered = build(log, { apexCode: 'DEBUG' });
    const inner = indexOf(log, 'ns.Inner.go()');

    const listed = [...logStoreFor(filtered).events()];

    expect(listed.map((event) => event.eventIndex)).not.toContain(inner);
    expect(listed).toEqual(expect.arrayContaining([filtered, ...walk(filtered)]));
  });

  it('gives each kept event one slot, besides the log itself', () => {
    const log = logOf();
    const filtered = build(log, { apexCode: 'DEBUG' });

    const own = filtered.eventsById.filter((event) => event !== filtered);

    expect(new Set(own).size).toBe(own.length);
    expect(own.reduce((sum, event) => sum + event.duration.self, 0) + filtered.duration.self).toBe(
      selfSum(filtered, 'duration'),
    );
  });

  it('keeps the class of every copy', () => {
    const log = logOf();
    const filtered = build(log, { apexCode: 'DEBUG' });
    const soql = indexOf(log, 'SELECT Id FROM Account');

    expect(filtered).toBeInstanceOf(log.constructor);
    expect(filtered.eventsById[soql]).toBeInstanceOf(log.eventsById[soql]!.constructor);
    expect(filtered.eventsById[soql]).not.toBe(log.eventsById[soql]);
  });

  it('drops hidden exceptions and remaps kept ones', () => {
    const log = logOf();

    const kept = build(log, { apexCode: 'DEBUG' });
    const hidden = build(log, { apexCode: 'WARN' });

    expect(kept.exceptions).toHaveLength(1);
    expect(kept.exceptions[0]).toBe(kept.eventsById[log.exceptions[0]!.eventIndex]);
    expect(hidden.exceptions).toHaveLength(0);
    expect(hidden.entryPoints.map((event) => event.eventIndex)).toEqual(
      log.entryPoints.map((event) => event.eventIndex),
    );
  });

  it('reports the chosen levels as the levels of the filtered log', () => {
    const filtered = build(logOf(), { apexCode: 'DEBUG' });

    expect(filtered.debugLevels).toEqual({
      apexCode: 'DEBUG',
      apexProfiling: 'NONE',
      database: 'FINEST',
      system: 'FINE',
    });
  });

  it('builds the same tree across many steps as in one', async () => {
    const log = longLog();
    const chosen: DebugLevels = { apexCode: 'DEBUG' };

    const sliced = await filterByLevels(log, chosen, { yieldSlice });
    const types = (root: ApexLog): string[] => walk(root).map((event) => `${event.type}`);

    expect(sliced && types(sliced)).toEqual(types(build(log, chosen)));
  });

  it('gives up once the signal aborts', async () => {
    const build = new AbortController();
    build.abort();
    let now = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => (now += 1000));

    expect(
      await filterByLevels(longLog(), { apexCode: 'DEBUG' }, { yieldSlice, signal: build.signal }),
    ).toBeNull();
  });

  it('keeps an event that states no level', () => {
    const event = { debugCategory: '', debugLevel: '' } as LogEvent;

    expect(isHidden(event, { apexCode: 'NONE' })).toBe(false);
  });

  it('compares levels by category', () => {
    expect(sameLevels({ apexCode: 'FINE' }, { apexCode: 'FINE' })).toBe(true);
    expect(sameLevels({ apexCode: 'FINE' }, { apexCode: 'DEBUG' })).toBe(false);
    expect(sameLevels({ apexCode: 'FINE' }, { apexCode: 'FINE', database: 'INFO' })).toBe(false);
  });
});
