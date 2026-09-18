/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from 'apex-log-parser';

/**
 * The fields the call tree and analysis passes read. Every count is a self/total
 * pair, so a test names only the half it asserts on and the rest stay zero.
 */
export interface EventOptions {
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
  heapSelf?: number;
  heapTotal?: number;
}

// Only so two events are told apart in a debugger. Nothing under test reads it,
// which is why no suite resets it.
let nextTimestamp = 1;

/**
 * A `LogEvent` carrying the fields these passes read, and no others. `Partial`
 * rather than a blind cast, so a renamed or reshaped field on the real class
 * fails the typecheck here instead of drifting silently.
 *
 * Do not add `eventIndex`. A built frame has none, so `keyPathIds.ts:61` finds
 * `undefined >= 0` false and skips its key cache. Give every frame index 0 — the
 * real class default — and they all read back the first frame's key.
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
    heapAllocated: { self: options.heapSelf ?? 0, total: options.heapTotal ?? 0 },
    heapGross: { self: 0, total: 0 },
    heapPeak: 0,
  };

  const built = event as LogEvent;
  options.parent?.children.push(built);
  return built;
}
