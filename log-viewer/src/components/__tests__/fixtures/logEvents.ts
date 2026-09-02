/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from 'apex-log-parser';

interface Count {
  self: number;
  total: number;
}

/** Only the fields the namespace walk and the window index read. */
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
  parent?: FakeEvent;
}

const count = (): Count => ({ self: 0, total: 0 });

const registry: FakeEvent[] = [];

/**
 * An event with its children's time folded into its total, registered so
 * {@link eventByIndex} finds it as the log's own map does.
 */
export function ev(namespace: string, self: number, children: FakeEvent[] = []): FakeEvent {
  const event: FakeEvent = {
    eventIndex: registry.length,
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
  for (const child of children) {
    child.parent = event;
  }
  registry.push(event);
  return event;
}

/** Clears the registry, so each test's indexes start at zero. */
export function resetEvents(): void {
  registry.length = 0;
}

export function eventByIndex(index: number): FakeEvent | null {
  return registry.find((event) => event.eventIndex === index) ?? null;
}

export const roots = (events: FakeEvent[]) => events as unknown as LogEvent[];

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
