/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

// `tree-converter` keys a node on the timestamp, so no two may share one.
let nextTimestamp = 1;

/**
 * The fields the call tree and analysis passes read. Every count is a self/total
 * pair, so a test names only the half it asserts on and the rest stay zero --
 * except `thrown`, which sets both.
 */
interface EventOptions {
  text: string;
  type?: string;
  namespace?: string;
  self?: number;
  total?: number;
  exitStamp?: number | null;
  suffix?: string | null;
  parent?: LogEvent | null;
  dmlSelf?: number;
  dmlTotal?: number;
  soqlSelf?: number;
  soqlTotal?: number;
  soslSelf?: number;
  soslTotal?: number;
  dmlRowSelf?: number;
  dmlRowTotal?: number;
  soqlRowSelf?: number;
  soqlRowTotal?: number;
  soslRowSelf?: number;
  soslRowTotal?: number;
  thrown?: number;
  heapTotal?: number;
}

/**
 * A `LogEvent` carrying the fields these passes read, and no others. `Partial`
 * rather than a blind cast, so a renamed or reshaped field on the real class
 * fails the typecheck here instead of drifting silently.
 *
 * Do not add `eventIndex`. `keyIdOf` in `core/log/keyPathIds.ts` keys every frame
 * that has no index onto one shared slot, so giving them all index 0 makes them
 * read back the first frame's key.
 */
export function createEvent(options: EventOptions): LogEvent {
  const event: Partial<LogEvent> = {
    parent: options.parent ?? null,
    children: [],
    type: (options.type ?? 'METHOD_ENTRY') as LogEvent['type'],
    text: options.text,
    namespace: options.namespace ?? 'default',
    suffix: options.suffix ?? null,
    cpuType: '',
    hasValidSymbols: true,
    timestamp: nextTimestamp++,
    exitStamp: options.exitStamp ?? null,
    duration: { self: options.self ?? 0, total: options.total ?? 0 },
    dmlRowCount: { self: options.dmlRowSelf ?? 0, total: options.dmlRowTotal ?? 0 },
    soqlRowCount: { self: options.soqlRowSelf ?? 0, total: options.soqlRowTotal ?? 0 },
    soslRowCount: { self: options.soslRowSelf ?? 0, total: options.soslRowTotal ?? 0 },
    dmlCount: { self: options.dmlSelf ?? 0, total: options.dmlTotal ?? 0 },
    soqlCount: { self: options.soqlSelf ?? 0, total: options.soqlTotal ?? 0 },
    soslCount: { self: options.soslSelf ?? 0, total: options.soslTotal ?? 0 },
    thrownCount: { self: options.thrown ?? 0, total: options.thrown ?? 0 },
    heapAllocated: { self: 0, total: options.heapTotal ?? 0 },
    heapGross: { self: 0, total: 0 },
    heapPeak: 0,
  };

  const built = event as LogEvent;
  options.parent?.children.push(built);
  return built;
}
