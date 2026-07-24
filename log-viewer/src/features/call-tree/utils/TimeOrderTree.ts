/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits, LogEvent, SelfTotal } from 'apex-log-parser';

import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { EXCLUDED_DETAIL_TYPES } from './DetailsFilter.js';
import { setGovernorCost } from './GovernorCost.js';

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
  /** Average governor consumption across all reported governors (0–100%). */
  governorCost: number;
  /** The single tightest governor consumed on this path (0–100+%). */
  governorCostMax: number;
  /**
   * True when this row is itself a "detail" (the per-row predicate matches —
   * non-zero `duration.total`, `isParent`, `discontinuity`, or a type in
   * `EXCLUDED_DETAIL_TYPES`) OR any descendant has `_hasDetailsDeep === true`.
   * Precomputed bottom-up at tree-build time so the Show-Details filter is
   * an O(1) property read instead of a recursive walk.
   */
  _hasDetailsDeep: boolean;
}

/**
 * Builds the time-order view: one row per LogEvent at every level. Row ids
 * use parser-assigned eventIndex values, which are globally unique within
 * the parse and safe for deepFilter cache keys.
 */
export function toTimeOrderTree(
  nodes: LogEvent[],
  governorLimits?: GovernorLimits,
): TimeOrderRow[] | undefined {
  const len = nodes.length;
  if (!len) {
    return undefined;
  }

  function buildRow(event: LogEvent): TimeOrderRow {
    const id = event.eventIndex;
    const children = event.children;
    const childCount = children.length;
    let mappedChildren: TimeOrderRow[] | null = null;
    let childHasDetailsDeep = false;
    if (childCount > 0) {
      mappedChildren = new Array<TimeOrderRow>(childCount);
      for (let i = 0; i < childCount; i++) {
        const childRow = buildRow(children[i]!);
        mappedChildren[i] = childRow;
        if (childRow._hasDetailsDeep) {
          childHasDetailsDeep = true;
        }
      }
    }
    const { duration, isParent, discontinuity, type } = event;
    const selfIsDetail =
      isParent ||
      duration.total > 0 ||
      discontinuity ||
      !!(type && EXCLUDED_DETAIL_TYPES.has(type));
    const row: TimeOrderRow = {
      id,
      originalData: event,
      _children: mappedChildren,
      text: event.text,
      namespace: event.namespace,
      callerNamespace: getCallerNamespace(event),
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
      _hasDetailsDeep: selfIsDetail || childHasDetailsDeep,
    };
    if (governorLimits) {
      setGovernorCost(row, governorLimits);
    }
    return row;
  }

  const results = new Array<TimeOrderRow>(len);
  for (let i = 0; i < len; i++) {
    results[i] = buildRow(nodes[i]!);
  }
  return results;
}
