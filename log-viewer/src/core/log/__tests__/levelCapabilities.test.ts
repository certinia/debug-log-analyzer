/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { DebugLevels, LogLevel } from '@apexdevtools/apex-log-parser';

import { storeOf } from '#test-helpers/apexLog.js';
import {
  CAPABILITIES,
  type Capability,
  type CapabilityId,
  describeLevelGap,
  findLevelGap,
} from '../levelCapabilities.js';
import { filterByLevels, LEVEL_ORDER, levelRank } from '../levelFilter.js';

const SETTINGS = '64.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST;DB,FINEST\n';

// One line of every event the map names.
const BODY =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1300)|VARIABLE_ASSIGNMENT|[2]|x|1\n' +
  '09:18:22.6 (1600)|SOQL_EXECUTE_BEGIN|[5]|Aggregations:0|SELECT Id FROM Account\n' +
  '09:18:22.6 (1700)|SOQL_EXECUTE_EXPLAIN|[5]|Index on Account : [Id], cardinality: 1, sobjectCardinality: 10, relativeCost 0.1\n' +
  '09:18:22.6 (1800)|SOQL_EXECUTE_END|[5]|Rows:1\n' +
  '09:18:22.6 (2200)|METHOD_EXIT|[1]|ns.Outer.run()\n' +
  '09:18:22.6 (2300)|CUMULATIVE_LIMIT_USAGE\n' +
  '09:18:22.6 (2400)|LIMIT_USAGE_FOR_NS|(default)|\n' +
  '  Number of SOQL queries: 1 out of 100\n' +
  '09:18:22.6 (2500)|CUMULATIVE_LIMIT_USAGE_END\n';

describe('CAPABILITIES', () => {
  const { log } = storeOf(BODY, SETTINGS);

  it.each(Object.entries(CAPABILITIES))(
    '%s states the level the parser gives its event',
    (_, cap) => {
      const event = log.eventsById.find((candidate) => candidate?.type === cap.event);
      expect(event).toBeDefined();
      expect({ category: event?.debugCategory, level: event?.debugLevel }).toEqual({
        category: cap.category,
        level: cap.level,
      });
    },
  );

  it.each(Object.entries<Capability>(CAPABILITIES).filter(([, cap]) => cap.filteredBelow !== null))(
    '%s is hidden by the header filter where the map says',
    async (_, cap: Capability) => {
      const at = cap.filteredBelow ?? cap.level;
      const below = LEVEL_ORDER[levelRank(at) - 1]!; // every capability needs more than NONE
      const has = async (level: LogLevel) =>
        (await filterByLevels(log, { [cap.category]: level }))?.eventsById.some(
          (event) => event?.type === cap.event,
        );

      expect(await has(at)).toBe(true);
      expect(await has(below)).toBe(false);
    },
  );
});

describe('findLevelGap', () => {
  const gap = (id: CapabilityId, logged: DebugLevels, chosen: DebugLevels = logged) =>
    findLevelGap(id, logged, chosen);

  it('is null when the log was captured at the level and nothing is lowered', () => {
    expect(gap('queryPlans', { database: 'FINEST' })).toBeNull();
  });

  it('reports a capture below the level, with the level logged', () => {
    expect(gap('queryPlans', { database: 'FINE' })).toEqual({
      kind: 'notCaptured',
      capability: CAPABILITIES.queryPlans,
      logged: 'FINE',
    });
  });

  it('reports a category the log does not state as not captured', () => {
    expect(gap('queryPlans', { apexCode: 'FINEST' })).toMatchObject({
      kind: 'notCaptured',
      logged: undefined,
    });
  });

  it('blames no level when the log states none', () => {
    expect(gap('queryPlans', {})).toBeNull();
  });

  it('reports a level lowered in the header as filtered', () => {
    expect(gap('queries', { database: 'FINEST' }, { database: 'WARN' })).toEqual({
      kind: 'filtered',
      capability: CAPABILITIES.queries,
      logged: 'FINEST',
      chosen: 'WARN',
    });
  });

  it.each([
    ['limits', { apexProfiling: 'INFO' }, { apexProfiling: 'NONE' }],
    ['queryPlans', { database: 'FINEST' }, { database: 'INFO' }],
  ] as [CapabilityId, DebugLevels, DebugLevels][])(
    'does not blame the header for %s, which its filter keeps',
    (id, logged, chosen) => {
      expect(gap(id, logged, chosen)).toBeNull();
    },
  );

  it('blames the header for query plans it hides with their queries', () => {
    expect(gap('queryPlans', { database: 'FINEST' }, { database: 'WARN' })).toMatchObject({
      kind: 'filtered',
      chosen: 'WARN',
    });
  });

  it('reports not captured over filtered, since raising the level cannot help', () => {
    expect(gap('variables', { apexCode: 'FINE' }, { apexCode: 'DEBUG' })).toMatchObject({
      kind: 'notCaptured',
    });
  });

  it('is null when the level is lowered but stays at or above what the feature needs', () => {
    expect(gap('queries', { database: 'FINEST' }, { database: 'INFO' })).toBeNull();
  });
});

describe('describeLevelGap', () => {
  it.each([
    [
      'queryPlans',
      { database: 'FINE' },
      { database: 'FINE' },
      'Query plans need a new log with DB at FINEST (logged: FINE).',
    ],
    [
      'queryPlans',
      { apexCode: 'FINEST' },
      { apexCode: 'FINEST' },
      'Query plans need a new log with DB at FINEST (no DB level in log).',
    ],
    [
      'limits',
      { apexProfiling: 'NONE' },
      { apexProfiling: 'NONE' },
      'Governor limits need a new log with APEX_PROFILING at INFO or higher (logged: NONE).',
    ],
    [
      'queries',
      { database: 'FINEST' },
      { database: 'WARN' },
      'Database statements hidden: DB is set to WARN in the header (logged: FINEST).',
    ],
  ] as [CapabilityId, DebugLevels, DebugLevels, string][])(
    '%s, %j chosen as %j, reads "%s"',
    (id, logged, chosen, text) => {
      expect(describeLevelGap(findLevelGap(id, logged, chosen))).toBe(text);
    },
  );

  it('is the fallback for no gap', () => {
    expect(describeLevelGap(null)).toBe('');
    expect(describeLevelGap(null, 'No data.')).toBe('No data.');
  });
});
