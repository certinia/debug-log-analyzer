/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  type ApexLog,
  EVENT_TYPES,
  eventType,
  LEVEL,
  type Level,
} from '@apexdevtools/apex-log-parser';

import { CHECK_EVERY, frameBudget, type FrameBudgetOptions } from '../utility/FrameBudget.js';

/** The level per debug category, as the log header states it or a user chooses it. */
export type DebugLevels = ApexLog['debugLevels'];

/** Coarsest first, as the parser declares them: a level shows every event at its own rank or below. */
export const LEVEL_ORDER: readonly Level[] = Object.values(LEVEL);

const RANK = new Map<Level, number>(LEVEL_ORDER.map((level, rank) => [level, rank]));

/** The position of `level` in {@link LEVEL_ORDER}, or -1 for a level the log did not state. */
export function levelRank(level: Level | undefined): number {
  return level ? (RANK.get(level) ?? -1) : -1;
}

const USER_DEBUG = eventType('USER_DEBUG').typeId;
// A detail line inside its block shows while the block shows, whatever its own level.
const LIMIT_USAGE_FOR_NS = eventType('LIMIT_USAGE_FOR_NS').typeId;
const CUMULATIVE_LIMIT_USAGE = eventType('CUMULATIVE_LIMIT_USAGE').typeId;

export function sameLevels(a: DebugLevels, b: DebugLevels): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof DebugLevels)[]);
  return [...keys].every((key) => a[key] === b[key]);
}

/** Each type's rank against the level chosen for its category: 1 when finer, so hidden. */
function hiddenTypes(chosen: DebugLevels): Uint8Array {
  return Uint8Array.from(EVENT_TYPES, ({ debugCategory, debugLevel }) => {
    const limit = chosen[debugCategory];
    return limit !== undefined && levelRank(debugLevel) > levelRank(limit) ? 1 : 0;
  });
}

/**
 * The events of `log` the `chosen` levels hide, as if it had been captured at
 * them: 1 by event id for a hidden one. Null when none is hidden. Built in slices;
 * undefined once `options.signal` aborts.
 *
 * A `USER_DEBUG` line is filtered by the level it was written at, as Salesforce
 * filters it.
 */
export async function hiddenByLevels(
  log: ApexLog,
  chosen: DebugLevels,
  options: FrameBudgetOptions = {},
): Promise<Uint8Array | null | undefined> {
  if (sameLevels(log.debugLevels, { ...log.debugLevels, ...chosen })) {
    return null;
  }
  const byType = hiddenTypes(chosen);
  const userDebugLimit = chosen.apexCode;
  const { type, parent } = log.columns;
  const count = log.eventCount;
  const hidden = new Uint8Array(count + 1);
  const tick = frameBudget(options);
  let any = false;
  for (let id = 1; id <= count; id++) {
    if (id % CHECK_EVERY === 0 && !(await tick())) {
      return undefined;
    }
    const typeId = type[id]!;
    let hide: number;
    if (typeId === LIMIT_USAGE_FOR_NS && type[parent[id]!] === CUMULATIVE_LIMIT_USAGE) {
      hide = hidden[parent[id]!]!;
    } else if (typeId === USER_DEBUG && userDebugLimit !== undefined) {
      // Only USER_DEBUG states its own level, so only it is read as an event.
      hide = levelRank(log.event(id)!.debugLevel) > levelRank(userDebugLimit) ? 1 : 0;
    } else {
      hide = byType[typeId]!;
    }
    hidden[id] = hide;
    any ||= hide === 1;
  }
  return any ? hidden : null;
}
