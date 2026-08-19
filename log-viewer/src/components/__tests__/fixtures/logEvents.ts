/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from 'apex-log-parser';

/** Only the fields the namespace walk reads. */
export interface FakeEvent {
  eventIndex: number;
  namespace: string;
  duration: { total: number; self: number };
  children: FakeEvent[];
  parent?: FakeEvent;
}

const registry: FakeEvent[] = [];

/**
 * An event with its children's time folded into its total, registered so
 * {@link eventByIndex} finds it as the log's own map does.
 */
export function ev(namespace: string, self: number, children: FakeEvent[] = []): FakeEvent {
  const event: FakeEvent = {
    eventIndex: registry.length,
    namespace,
    duration: {
      total: self + children.reduce((sum, child) => sum + child.duration.total, 0),
      self,
    },
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

export const log = (children: FakeEvent[], namespaces: string[] = []) =>
  ({ children, namespaces }) as unknown as ApexLog;
