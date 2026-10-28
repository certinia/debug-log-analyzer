/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  DEBUG_CATEGORY_TOKEN,
  type DebugCategory,
  type EventType,
  eventType,
  type Level,
} from '@apexdevtools/apex-log-parser';

import { type DebugLevels, levelRank } from './levelFilter.js';

/** The event that feeds a feature, and the debug level that writes it. */
export interface Capability {
  /** Plural, as the hint reads `<label> need …`. */
  readonly label: string;
  readonly event: EventType;
  readonly category: DebugCategory;
  readonly level: Level;
  /** Where the header's filter hides the data, if not below `level`; null where it never does. */
  readonly filteredBelow?: Level | null;
}

function capability(label: string, event: EventType, filteredBelow?: Level | null): Capability {
  const { debugCategory, debugLevel } = eventType(event);
  return { label, event, category: debugCategory, level: debugLevel, filteredBelow };
}

export const CAPABILITIES = {
  variables: capability('Variables', 'VARIABLE_ASSIGNMENT'),
  queries: capability('Database statements', 'SOQL_EXECUTE_BEGIN'),
  // A plan rides on its query, so it shows while the query does.
  queryPlans: capability('Query plans', 'SOQL_EXECUTE_EXPLAIN', 'INFO'),
  limits: capability('Governor limits', 'CUMULATIVE_LIMIT_USAGE', null),
} as const satisfies Record<string, Capability>;

export type CapabilityId = keyof typeof CAPABILITIES;

/** Why the debug levels could keep a feature's events off screen. */
export type LevelGap =
  | { kind: 'notCaptured'; capability: Capability; logged: Level | undefined }
  | { kind: 'filtered'; capability: Capability; logged: Level; chosen: Level };

/**
 * Whether the levels could keep `id`'s events off screen: the log was captured
 * below its level, or a level chosen in the header hides them. Null when neither.
 * A gap is not proof the events are missing, so a caller checks its data first.
 */
export function findLevelGap(
  id: CapabilityId,
  logged: DebugLevels,
  chosen: DebugLevels,
): LevelGap | null {
  // A log with no settings line states no levels, so no level is to blame.
  if (!Object.keys(logged).length) {
    return null;
  }
  const capability: Capability = CAPABILITIES[id];
  const needed = levelRank(capability.level);
  const loggedLevel = logged[capability.category];
  if (loggedLevel === undefined || levelRank(loggedLevel) < needed) {
    return { kind: 'notCaptured', capability, logged: loggedLevel };
  }
  const chosenLevel = chosen[capability.category];
  const filteredBelow =
    capability.filteredBelow === undefined ? capability.level : capability.filteredBelow;
  if (
    filteredBelow !== null &&
    chosenLevel !== undefined &&
    levelRank(chosenLevel) < levelRank(filteredBelow)
  ) {
    return { kind: 'filtered', capability, logged: loggedLevel, chosen: chosenLevel };
  }
  return null;
}

/**
 * The gap as one sentence, e.g. `Query plans need a new log with DB at FINEST (logged: FINE).`,
 * or `fallback` for none.
 */
export function describeLevelGap(gap: LevelGap | null | undefined, fallback = ''): string {
  if (!gap) {
    return fallback;
  }
  const { label, category, level } = gap.capability;
  const token = DEBUG_CATEGORY_TOKEN[category];
  if (gap.kind === 'filtered') {
    return `${label} hidden: ${token} is set to ${gap.chosen} in the header (logged: ${gap.logged}).`;
  }
  const atLeast = level === 'FINEST' ? level : `${level} or higher`;
  const logged = gap.logged ? `logged: ${gap.logged}` : `no ${token} level in log`;
  return `${label} need a new log with ${token} at ${atLeast} (${logged}).`;
}
