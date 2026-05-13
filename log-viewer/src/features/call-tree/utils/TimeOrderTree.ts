/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent, SelfTotal } from 'apex-log-parser';

import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';

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
    if (childCount > 0) {
      mappedChildren = new Array<TimeOrderRow>(childCount);
      for (let i = 0; i < childCount; i++) {
        mappedChildren[i] = buildRow(children[i]!);
      }
    }
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
    };
  }

  const results = new Array<TimeOrderRow>(len);
  for (let i = 0; i < len; i++) {
    results[i] = buildRow(nodes[i]!);
  }
  return results;
}
