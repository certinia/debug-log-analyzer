/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

/** Only the fields the namespace sums read. */
export interface FakeEvent {
  eventIndex: number;
  namespace: string;
  duration: { total: number; self: number };
  children: FakeEvent[];
}

/** An event with its children's time folded into its total; `indexTree` numbers it. */
export function namespaceEvent(
  namespace: string,
  self: number,
  children: FakeEvent[] = [],
): FakeEvent {
  return {
    eventIndex: -1,
    namespace,
    duration: {
      total: self + children.reduce((sum, child) => sum + child.duration.total, 0),
      self,
    },
    children,
  };
}

export const log = (children: FakeEvent[], namespaces: string[] = []) =>
  ({ children, namespaces }) as unknown as ApexLog;
