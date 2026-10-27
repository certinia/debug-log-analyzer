/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent, GovernorLimits, SelfTotal } from '@apexdevtools/apex-log-parser';

import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { costLimitsOf, setGovernorCost } from './GovernorCost.js';

/**
 * One row per LogEvent for the time-order view; no merging at any level.
 */
export interface TimeOrderRow {
  id: number;
  originalData: LogEvent;
  _children: TimeOrderRow[] | null;
  text: string;
  namespace: string;
  callerNamespace: string;
  /** Event type (e.g. METHOD_ENTRY) — an optional column, off by default. */
  type: string;
  duration: SelfTotal;
  dmlCount: SelfTotal;
  soqlCount: SelfTotal;
  soslCount: SelfTotal;
  dmlRowCount: SelfTotal;
  soqlRowCount: SelfTotal;
  soslRowCount: SelfTotal;
  thrownCount: SelfTotal;
  heapAllocated: SelfTotal;
  /** Total + self gross heap bytes allocated (frees ignored) — churn */
  heapGross: SelfTotal;
  /** Peak live heap (bytes) reached in this node's subtree — the limit-comparable value */
  heapPeak: number;
  /** Average governor consumption across all reported governors (0–100%); null if none. */
  governorCost: number | null;
  /** The single tightest governor consumed on this path (0–100+%). */
  governorCostMax: number | null;
}

/**
 * Builds the time-order view: one row per LogEvent at every level. Row ids
 * use parser-assigned eventIndex values, which are unique within the parse.
 */
export function toTimeOrderTree(
  nodes: LogEvent[],
  governorLimits?: GovernorLimits,
): TimeOrderRow[] | undefined {
  const len = nodes.length;
  if (!len) {
    return undefined;
  }
  const costLimits = governorLimits && costLimitsOf(governorLimits);

  function buildRow(event: LogEvent): TimeOrderRow {
    const id = event.eventIndex;
    const children = event.children;
    const childCount = children.length;
    let mappedChildren: TimeOrderRow[] | null = null;
    if (childCount > 0) {
      mappedChildren = new Array<TimeOrderRow>(childCount);
      for (let i = 0; i < childCount; i++) {
        mappedChildren[i] = buildRow(children[i]!);
      }
    }
    const { type } = event;
    const row: TimeOrderRow = {
      id,
      originalData: event,
      _children: mappedChildren,
      text: event.text,
      namespace: event.namespace,
      callerNamespace: getCallerNamespace(event),
      type: type ?? '',
      duration: event.duration,
      dmlCount: event.dmlCount,
      soqlCount: event.soqlCount,
      soslCount: event.soslCount,
      dmlRowCount: event.dmlRowCount,
      soqlRowCount: event.soqlRowCount,
      soslRowCount: event.soslRowCount,
      thrownCount: event.thrownCount,
      heapAllocated: event.heapAllocated,
      heapGross: event.heapGross,
      heapPeak: event.heapPeak,
      governorCost: 0,
      governorCostMax: 0,
    };
    if (costLimits) {
      setGovernorCost(row, costLimits);
    }
    return row;
  }

  const results = new Array<TimeOrderRow>(len);
  for (let i = 0; i < len; i++) {
    results[i] = buildRow(nodes[i]!);
  }
  return results;
}
