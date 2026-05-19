/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent, SelfTotal } from 'apex-log-parser';

import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { EXCLUDED_DETAIL_TYPES } from './DetailsFilter.js';

/**
 * One row per LogEvent for the time-order view; no merging at any level.
 */
export interface TimeOrderRow {
  id: string;
  originalData: LogEvent;
  _children: TimeOrderRow[] | null;
  text: string;
  namespace: string;
  callerNamespace: string;
  duration: SelfTotal;
  dmlCount: SelfTotal;
  soqlCount: SelfTotal;
  dmlRowCount: SelfTotal;
  soqlRowCount: SelfTotal;
  totalThrownCount: number;
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
 * are a per-build monotonic counter (`tt-N`) so they are globally unique
 * within the returned tree, which lets `deepFilter` cache results across
 * cascaded Tabulator subtree filter passes without collision.
 */
export function toTimeOrderTree(nodes: LogEvent[]): TimeOrderRow[] | undefined {
  const len = nodes.length;
  if (!len) {
    return undefined;
  }

  let next = 0;

  function buildRow(event: LogEvent): TimeOrderRow {
    const id = `tt-${++next}`;
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
    return {
      id,
      originalData: event,
      _children: mappedChildren,
      text: event.text,
      namespace: event.namespace,
      callerNamespace: getCallerNamespace(event),
      duration: event.duration,
      dmlCount: event.dmlCount,
      soqlCount: event.soqlCount,
      dmlRowCount: event.dmlRowCount,
      soqlRowCount: event.soqlRowCount,
      totalThrownCount: event.totalThrownCount,
      _hasDetailsDeep: selfIsDetail || childHasDetailsDeep,
    };
  }

  const results = new Array<TimeOrderRow>(len);
  for (let i = 0; i < len; i++) {
    results[i] = buildRow(nodes[i]!);
  }
  return results;
}
