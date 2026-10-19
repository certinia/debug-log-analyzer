/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  type ApexLog,
  type CodeUnitStartedLine,
  type DebugLevels,
  LOG_LEVEL,
  type LogEvent,
  type LogLevel,
  type SelfTotal,
} from '@apexdevtools/apex-log-parser';

import { CHECK_EVERY, frameBudget, type FrameBudgetOptions } from '../utility/FrameBudget.js';

type Level = Exclude<LogLevel, ''>;

/** Coarsest first, as the parser declares them: a level shows every event at its own rank or below. */
export const LEVEL_ORDER: readonly Level[] = Object.values(LOG_LEVEL);

const RANK = new Map<Level, number>(LEVEL_ORDER.map((level, rank) => [level, rank]));

/** The position of `level` in {@link LEVEL_ORDER}, or -1 for a level the log did not state. */
export function levelRank(level: LogLevel | undefined): number {
  return level ? (RANK.get(level) ?? -1) : -1;
}

// The parser gives every USER_DEBUG line DEBUG, but Salesforce filters it by the level it was written at.
function levelOf(event: LogEvent): LogLevel {
  if (event.type === 'USER_DEBUG') {
    const written = event.text.split(' | ', 1)[0] as Level;
    if (RANK.has(written)) {
      return written;
    }
  }
  return event.debugLevel;
}

/** True when `event` is finer than the level chosen for its category. */
export function isHidden(event: LogEvent, chosen: DebugLevels): boolean {
  const { debugCategory, debugLevel } = event;
  if (!debugCategory || !debugLevel) {
    return false;
  }
  const limit = chosen[debugCategory];
  return limit !== undefined && levelRank(levelOf(event)) > levelRank(limit);
}

export function sameLevels(a: DebugLevels, b: DebugLevels): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof DebugLevels)[]);
  return [...keys].every((key) => a[key] === b[key]);
}

const COUNTERS = [
  'duration',
  'dmlCount',
  'soqlCount',
  'soslCount',
  'dmlRowCount',
  'soqlRowCount',
  'soslRowCount',
  'thrownCount',
  'heapAllocated',
  'heapGross',
] as const satisfies readonly (keyof LogEvent)[];

// Not `Object.create(event)`: V8 turns a prototype into a slow object, so walks of the original log slow down too.
function copyOf<T extends LogEvent>(event: T): T {
  const copy: T = Object.setPrototypeOf({ ...event }, Object.getPrototypeOf(event));
  copy.children = [];
  return copy;
}

/**
 * Builds the log as if it had been captured at `chosen` levels, in slices.
 *
 * A hidden event's kept descendants move up to its nearest kept ancestor, in log
 * order, and its self counters fold into that ancestor's self. Totals do not
 * change. The original log is not touched: a copy shares an original's counters
 * until it takes a fold.
 */
export class LevelFilterBuilder {
  private readonly original: ApexLog;
  private readonly chosen: DebugLevels;
  private readonly root: ApexLog;
  private readonly slots: LogEvent[];
  private readonly ownCounters = new Set<LogEvent>();
  private readonly namespaces = new Set<string>();
  private hidden = 0;

  // One entry per open level: the children being read, the next one to read, and
  // the kept copy that takes them.
  private readonly levelChildren: LogEvent[][];
  private readonly levelCursor: number[] = [0];
  private readonly levelKept: LogEvent[];

  constructor(original: ApexLog, chosen: DebugLevels) {
    this.original = original;
    this.chosen = chosen;
    this.root = copyOf(original);
    this.slots = new Array<LogEvent>(original.eventsById.length);
    this.slots[original.eventIndex] = this.root;
    this.levelChildren = [original.children];
    this.levelKept = [this.root];
  }

  /** Reads up to `maxEvents` events. Returns true once the whole tree is read. */
  step(maxEvents: number): boolean {
    const { levelChildren, levelCursor, levelKept } = this;
    let budget = maxEvents;
    while (levelChildren.length && budget > 0) {
      const level = levelChildren.length - 1;
      const children = levelChildren[level]!;
      const cursor = levelCursor[level]!;
      if (cursor === children.length) {
        levelChildren.pop();
        levelCursor.pop();
        levelKept.pop();
        continue;
      }
      levelCursor[level] = cursor + 1;
      budget--;

      const event = children[cursor]!;
      const keeper = levelKept[level]!;
      let next = keeper;
      if (isHidden(event, this.chosen)) {
        this.hidden++;
        this.fold(keeper, event);
        this.slots[event.eventIndex] = this.root;
      } else {
        next = copyOf(event);
        next.parent = keeper;
        keeper.children.push(next);
        this.namespaces.add(next.namespace);
        this.slots[event.eventIndex] = next;
      }

      if (event.children.length) {
        levelChildren.push(event.children);
        levelCursor.push(0);
        levelKept.push(next);
      }
    }
    return levelChildren.length === 0;
  }

  finish(): ApexLog {
    const { original, root, slots } = this;
    // A hidden slot holds the root, which every loop over the slots already skips.
    // Exit lines and merged events are not in the tree: a kept one stays as it is.
    original.eventsById.forEach((event, index) => {
      if (!slots[index]) {
        const hidden = isHidden(event, this.chosen);
        slots[index] = hidden ? root : event;
        if (hidden) {
          this.hidden++;
        } else {
          this.namespaces.add(event.namespace);
        }
      }
    });
    if (!this.hidden) {
      return original;
    }

    root.eventsById = slots;
    root.debugLevels = { ...original.debugLevels, ...this.chosen };
    root.namespaces = original.namespaces.filter((namespace) => this.namespaces.has(namespace));
    root.exceptions = this.kept(original.exceptions);
    root.entryPoints = this.kept(original.entryPoints) as CodeUnitStartedLine[];
    root.truncatedEvents = this.kept(original.truncatedEvents);
    return root;
  }

  private kept(events: LogEvent[]): LogEvent[] {
    return events
      .map((event) => this.slots[event.eventIndex]!)
      .filter((event) => event !== this.root);
  }

  private fold(keeper: LogEvent, hidden: LogEvent): void {
    if (!this.ownCounters.has(keeper)) {
      this.ownCounters.add(keeper);
      for (const key of COUNTERS) {
        const { self, total }: SelfTotal = keeper[key];
        keeper[key] = { self, total };
      }
    }
    for (const key of COUNTERS) {
      keeper[key].self += hidden[key].self;
    }
  }
}

/**
 * `log` as if captured at `chosen` levels, built in slices. `log` itself when
 * nothing is hidden. Null once `options.signal` aborts.
 */
export async function filterByLevels(
  log: ApexLog,
  chosen: DebugLevels,
  options: FrameBudgetOptions = {},
): Promise<ApexLog | null> {
  if (sameLevels(log.debugLevels, { ...log.debugLevels, ...chosen })) {
    return log;
  }
  const builder = new LevelFilterBuilder(log, chosen);
  const tick = frameBudget(options);
  while (!builder.step(CHECK_EVERY)) {
    if (!(await tick())) {
      return null;
    }
  }
  return builder.finish();
}
