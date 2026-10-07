/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

interface Count {
  self: number;
  total: number;
}

/** Only the fields the namespace sums and the window index read. */
export interface FakeEvent {
  eventIndex: number;
  namespace: string;
  category: string;
  duration: { total: number; self: number };
  /** Laid out by {@link log}, which is what puts the tree in time. */
  timestamp: number;
  exitStamp: number;
  soqlCount: Count;
  soqlRowCount: Count;
  dmlCount: Count;
  dmlRowCount: Count;
  soslCount: Count;
  children: FakeEvent[];
}

const count = (): Count => ({ self: 0, total: 0 });

/** An event with its children's time folded into its total; `indexTree` numbers it. */
export function namespaceEvent(
  namespace: string,
  self: number,
  children: FakeEvent[] = [],
): FakeEvent {
  return {
    eventIndex: -1,
    namespace,
    category: 'Apex',
    duration: {
      total: self + children.reduce((sum, child) => sum + child.duration.total, 0),
      self,
    },
    timestamp: 0,
    exitStamp: 0,
    soqlCount: count(),
    soqlRowCount: count(),
    dmlCount: count(),
    dmlRowCount: count(),
    soslCount: count(),
    children,
  };
}

/**
 * Lays `event` out from `start` and returns where it ends: its own time first,
 * then its children back to back. A windowed read needs real timestamps, and
 * this keeps each event's own time exactly its `duration.self`.
 */
function layOut(event: FakeEvent, start: number): number {
  event.timestamp = start;
  let cursor = start + event.duration.self;
  for (const child of event.children) {
    cursor = layOut(child, cursor);
  }
  event.exitStamp = cursor;
  return cursor;
}

export const log = (children: FakeEvent[], namespaces: string[] = []) => {
  let cursor = 0;
  for (const child of children) {
    cursor = layOut(child, cursor);
  }
  return { children, namespaces, timestamp: 0, exitStamp: cursor } as unknown as ApexLog;
};
