/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */

import type { LogEvent, SelfTotal } from 'apex-log-parser';
import { Multiset } from '../../../core/utility/Multiset.js';

/**
 * Represents a row in the aggregated call tree view.
 * All calls to the same function signature are merged, with children also aggregated.
 */
export interface AggregatedRow {
  /** Unique identifier for the row */
  id: string;
  /** Unique grouping key for this function signature */
  key: string;
  /** Display name */
  text: string;
  /** Package namespace */
  namespace: string;
  /** Number of times this function was called */
  callCount: number;
  /** Sum of self-time across all calls */
  totalSelfTime: number;
  /** Sum of total-time across all calls */
  totalTime: number;
  /** Average self-time per call */
  avgSelfTime: number;
  /** Total DML count */
  dmlCount: SelfTotal;
  /** Total SOQL count */
  soqlCount: SelfTotal;
  /** Total DML rows */
  dmlRowCount: SelfTotal;
  /** Total SOQL rows */
  soqlRowCount: SelfTotal;
  /** Total exceptions thrown */
  totalThrownCount: number;
  /** Aggregated children (callees grouped by signature) */
  _children: AggregatedRow[] | null;
  /** References to original events for drill-down */
  instances: LogEvent[];
  /** Representative event for this row (used by formatters) */
  originalData: LogEvent;
}

/**
 * Represents a row in the bottom-up tree view.
 * Functions sorted by self-time, with callers (parents) as children.
 */
export interface BottomUpRow {
  /** Unique identifier for the row */
  id: string;
  /** Unique grouping key for this function signature */
  key: string;
  /** Display name */
  text: string;
  /** Package namespace */
  namespace: string;
  /** Event type (e.g., METHOD_ENTRY, CODE_UNIT_STARTED) */
  type: string;
  /** Number of times this function was called */
  callCount: number;
  /** Sum of self-time across all calls */
  totalSelfTime: number;
  /** Sum of total-time across all calls */
  totalTime: number;
  /** Average self-time per call */
  avgSelfTime: number;
  /** Total DML count */
  dmlCount: SelfTotal;
  /** Total SOQL count */
  soqlCount: SelfTotal;
  /** Total DML rows */
  dmlRowCount: SelfTotal;
  /** Total SOQL rows */
  soqlRowCount: SelfTotal;
  /** Total exceptions thrown */
  totalThrownCount: number;
  /** Callers (parent functions) as children - lazy loaded */
  _children: BottomUpRow[] | null;
  /** References to the displayed events for drill-down */
  instances: LogEvent[];
  /** Instances whose metrics are being attributed through this caller path */
  contributionInstances: LogEvent[];
  /** Representative event for this row (used by formatters) */
  originalData: LogEvent;
}

/**
 * Generates a unique key for grouping events by signature.
 * Includes event type so different entry types (e.g. CODE_UNIT_STARTED vs METHOD_ENTRY)
 * are displayed as separate rows. Field order (type|namespace|text) is the shared
 * canonical bucket-key shape used by aggregated, bottom-up, and analysis views.
 */
export function getEventKey(event: LogEvent): string {
  return `${event.type ?? ''}|${event.namespace}|${event.text}`;
}

/**
 * Generates a key for call-stack tracking to detect recursive calls.
 * Excludes event type so the same method is recognised regardless of entry type
 * (e.g. CODE_UNIT_STARTED at the top level, METHOD_ENTRY for recursive calls).
 * Matches the approach used by the analysis view's RowGrouper.
 */
function getStackKey(event: LogEvent): string {
  return `${event.namespace}|${event.text}`;
}

/**
 * Creates an aggregated call tree where all calls to the same function signature
 * are merged together, with aggregated metrics.
 * Uses Multiset call-stack tracking to prevent double-counting of recursive calls.
 */
export function toAggregatedCallTree(rootChildren: LogEvent[]): AggregatedRow[] {
  if (rootChildren.length === 0) {
    return [];
  }

  // Group root-level events by signature with call stack tracking
  const rootMap = new Map<string, AggregatedRow>();
  const keyStack = new Multiset<string>();

  for (const event of rootChildren) {
    // Process every event so callCount/DML/SOQL/exception counts roll up even
    // when the event has no timing contribution.
    const key = getEventKey(event);
    let row = rootMap.get(key);

    if (!row) {
      row = createEmptyAggregatedRow(key, event);
      rootMap.set(key, row);
    }

    const stackKey = getStackKey(event);
    addEventToAggregatedRowWithStack(row, event, stackKey, keyStack);
  }

  // Recursively aggregate children for each row
  for (const row of rootMap.values()) {
    const firstInstance = row.instances[0];
    const stackKey = firstInstance ? getStackKey(firstInstance) : row.key;
    row._children = aggregateChildrenRecursive(row.instances, stackKey);
    calculateAverages(row);
  }

  // Sort by total time descending
  return Array.from(rootMap.values()).sort((a, b) => b.totalTime - a.totalTime);
}

/**
 * Recursively aggregates children of all instances.
 * Tracks the parent key to detect recursive calls within the same aggregation context.
 */
function aggregateChildrenRecursive(
  instances: LogEvent[],
  parentStackKey: string,
): AggregatedRow[] | null {
  const childMap = new Map<string, AggregatedRow>();
  // Create a new stack for each aggregation level, starting with the parent stack key
  const keyStack = new Multiset<string>();
  keyStack.add(parentStackKey);

  for (const instance of instances) {
    for (const child of instance.children) {
      const key = getEventKey(child);
      let row = childMap.get(key);

      if (!row) {
        row = createEmptyAggregatedRow(key, child);
        childMap.set(key, row);
      }

      const stackKey = getStackKey(child);
      addEventToAggregatedRowWithStack(row, child, stackKey, keyStack);
    }
  }

  if (childMap.size === 0) {
    return null;
  }

  // Recursively aggregate children using stack key for recursion tracking
  for (const row of childMap.values()) {
    const firstInstance = row.instances[0];
    const stackKey = firstInstance ? getStackKey(firstInstance) : row.key;
    row._children = aggregateChildrenRecursive(row.instances, stackKey);
    calculateAverages(row);
  }

  // Sort by total time descending
  return Array.from(childMap.values()).sort((a, b) => b.totalTime - a.totalTime);
}

/**
 * Adds an event to an aggregated row, using call stack tracking to prevent
 * double-counting of totalTime for recursive calls.
 */
function addEventToAggregatedRowWithStack(
  row: AggregatedRow,
  event: LogEvent,
  stackKey: string,
  keyStack: Multiset<string>,
): void {
  row.callCount++;
  row.totalSelfTime += event.duration.self; // Always add self time

  // Only add totalTime if this method is not already on the stack (avoids recursive double-counting)
  // Uses stackKey (text+namespace, no type) so CODE_UNIT_STARTED and METHOD_ENTRY for the same
  // method are recognised as the same function in the call stack.
  if (!keyStack.has(stackKey)) {
    row.totalTime += event.duration.total;
  }

  row.dmlCount.self += event.dmlCount.self;
  row.dmlCount.total += event.dmlCount.total;
  row.soqlCount.self += event.soqlCount.self;
  row.soqlCount.total += event.soqlCount.total;
  row.dmlRowCount.self += event.dmlRowCount.self;
  row.dmlRowCount.total += event.dmlRowCount.total;
  row.soqlRowCount.self += event.soqlRowCount.self;
  row.soqlRowCount.total += event.soqlRowCount.total;
  row.totalThrownCount += event.totalThrownCount;
  row.instances.push(event);
}

/**
 * Converts top-down call trees into bottom-up call trees.
 *
 * Bottom-up roots are callees; children are reversed callers.
 * For every metric pair M.self/M.total (for example time, soqlRows), values are
 * attributed once using deepest active frame assignment and then bucketed by
 * reversed caller path. At every node, child partitions must sum to parent for
 * both self and total. Totals are non-overlapping and recursion-safe.
 *
 * Algorithm (see BOTTOM_UP_CALL_TREE_SPEC.md):
 *   1. Compute per-frame attributed totals. For every frame F with name R,
 *      attr(F) = F.total - Σ T for each nearest same-name descendant T. The DFS
 *      maintains Map<name, deepest-active-frame> and subtracts descendant totals
 *      from their nearest same-name ancestor on entry.
 *   2. For every frame F with F.duration.self > 0, walk its ancestor chain and
 *      insert F into a trie keyed by [F.name, F.parent.name, F.grandparent.name, …].
 *      At every prefix, accumulate F.self (bucket.self) and attr(F) (bucket.total)
 *      plus the matching metric pairs.
 *   3. Finalize averages and sort deterministically (totalSelfTime desc, name asc).
 */
export function toBottomUpTree(rootChildren: LogEvent[]): BottomUpRow[] {
  if (rootChildren.length === 0) {
    return [];
  }

  const attributionMap = computeFrameAttribution(rootChildren);
  const rootBuckets = new Map<string, BottomUpRow>();

  for (const frame of attributionMap.keys()) {
    // Insert every frame so callCount and DML/SOQL/exception attributions roll up
    // even for frames whose self-time contribution is zero.
    insertFrameIntoTrie(frame, attributionMap, rootBuckets);
  }

  return finalizeBuckets(rootBuckets);
}

type FrameAttribution = {
  totalTime: number;
  dmlTotal: number;
  soqlTotal: number;
  dmlRowTotal: number;
  soqlRowTotal: number;
  thrownTotal: number;
};

/**
 * Walks the top-down tree tracking the deepest active same-name ancestor per name.
 * For each event E, if there is already an active frame A with the same name,
 * subtract E's totals from A's attribution — because E's subtree belongs to E's
 * own bucket, not A's. Every visited event receives an attribution entry whose
 * initial values equal the event's own totals; same-name descendants trim those
 * down to the non-overlapping slice attributable to this frame alone.
 */
function computeFrameAttribution(rootChildren: LogEvent[]): Map<LogEvent, FrameAttribution> {
  const attributionMap = new Map<LogEvent, FrameAttribution>();
  const activeByName = new Map<string, LogEvent>();

  const visit = (node: LogEvent): void => {
    const key = getStackKey(node);
    const nearestSameName = activeByName.get(key);

    getOrInitAttribution(attributionMap, node);

    if (nearestSameName) {
      const nearestAttr = getOrInitAttribution(attributionMap, nearestSameName);
      nearestAttr.totalTime -= node.duration.total;
      nearestAttr.dmlTotal -= node.dmlCount.total;
      nearestAttr.soqlTotal -= node.soqlCount.total;
      nearestAttr.dmlRowTotal -= node.dmlRowCount.total;
      nearestAttr.soqlRowTotal -= node.soqlRowCount.total;
      nearestAttr.thrownTotal -= node.totalThrownCount;
    }

    activeByName.set(key, node);
    for (const child of node.children) {
      visit(child);
    }
    if (nearestSameName) {
      activeByName.set(key, nearestSameName);
    } else {
      activeByName.delete(key);
    }
  };

  for (const child of rootChildren) {
    visit(child);
  }

  return attributionMap;
}

function getOrInitAttribution(
  map: Map<LogEvent, FrameAttribution>,
  frame: LogEvent,
): FrameAttribution {
  const existing = map.get(frame);
  if (existing) {
    return existing;
  }
  const entry: FrameAttribution = {
    totalTime: frame.duration.total,
    dmlTotal: frame.dmlCount.total,
    soqlTotal: frame.soqlCount.total,
    dmlRowTotal: frame.dmlRowCount.total,
    soqlRowTotal: frame.soqlRowCount.total,
    thrownTotal: frame.totalThrownCount,
  };
  map.set(frame, entry);
  return entry;
}

/**
 * Inserts a frame into the bucket trie at every prefix of its ancestor chain.
 * Depth 0 is the root bucket (keyed by the frame's own name); deeper buckets are
 * keyed by each successive ancestor's name. The frame's attributed metrics are
 * added at every prefix — the partition invariant (children sum to parent) is
 * preserved because each frame contributes its own self / attr exactly once per
 * depth and the child buckets partition the parent by ancestor identity.
 */
function insertFrameIntoTrie(
  frame: LogEvent,
  attributionMap: Map<LogEvent, FrameAttribution>,
  rootBuckets: Map<string, BottomUpRow>,
): void {
  const attribution = getOrInitAttribution(attributionMap, frame);
  const rootKey = getEventKey(frame);
  let bucket = rootBuckets.get(rootKey);
  if (!bucket) {
    bucket = createEmptyBottomUpRow(rootKey, frame);
    rootBuckets.set(rootKey, bucket);
  }
  accumulateContribution(bucket, frame, frame, attribution);

  let ancestor = frame.parent;
  let parentBucket = bucket;
  while (ancestor && ancestor.text !== 'LOG_ROOT') {
    const ancestorKey = getEventKey(ancestor);
    const existingChildren = parentBucket._children ?? [];
    let childBucket = existingChildren.find((candidate) => candidate.key === ancestorKey);
    if (!childBucket) {
      childBucket = createEmptyBottomUpRow(ancestorKey, ancestor);
      existingChildren.push(childBucket);
      parentBucket._children = existingChildren;
    }
    accumulateContribution(childBucket, frame, ancestor, attribution);
    parentBucket = childBucket;
    ancestor = ancestor.parent;
  }
}

function accumulateContribution(
  bucket: BottomUpRow,
  frame: LogEvent,
  displayEvent: LogEvent,
  attribution: FrameAttribution,
): void {
  bucket.callCount++;
  bucket.totalSelfTime += frame.duration.self;
  bucket.totalTime += attribution.totalTime;
  bucket.dmlCount.self += frame.dmlCount.self;
  bucket.dmlCount.total += attribution.dmlTotal;
  bucket.soqlCount.self += frame.soqlCount.self;
  bucket.soqlCount.total += attribution.soqlTotal;
  bucket.dmlRowCount.self += frame.dmlRowCount.self;
  bucket.dmlRowCount.total += attribution.dmlRowTotal;
  bucket.soqlRowCount.self += frame.soqlRowCount.self;
  bucket.soqlRowCount.total += attribution.soqlRowTotal;
  bucket.totalThrownCount += attribution.thrownTotal;
  bucket.instances.push(displayEvent);
  bucket.contributionInstances.push(frame);
}

/**
 * Walks the bucket trie computing averages and applying deterministic ordering
 * (primary metric total-self desc, then name asc) at every level. Empty child
 * arrays are collapsed to null so Tabulator's dataTree renders a leaf indicator.
 */
function finalizeBuckets(rootBuckets: Map<string, BottomUpRow>): BottomUpRow[] {
  const roots = Array.from(rootBuckets.values());
  for (const row of roots) {
    finalizeBucketRecursive(row);
  }
  sortBuckets(roots);
  return roots;
}

function finalizeBucketRecursive(row: BottomUpRow): void {
  calculateBottomUpAverages(row);
  if (row._children && row._children.length > 0) {
    for (const child of row._children) {
      finalizeBucketRecursive(child);
    }
    sortBuckets(row._children);
  } else {
    row._children = null;
  }
}

function sortBuckets(rows: BottomUpRow[]): void {
  rows.sort((a, b) => {
    const delta = b.totalSelfTime - a.totalSelfTime;
    if (delta !== 0) {
      return delta;
    }
    return a.text.localeCompare(b.text);
  });
}

function createEmptyAggregatedRow(key: string, event: LogEvent): AggregatedRow {
  return {
    id: `agg-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    key,
    text: event.text,
    namespace: event.namespace,
    callCount: 0,
    totalSelfTime: 0,
    totalTime: 0,
    avgSelfTime: 0,
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    totalThrownCount: 0,
    _children: null,
    instances: [],
    originalData: event,
  };
}

function createEmptyBottomUpRow(key: string, event: LogEvent): BottomUpRow {
  return {
    id: `bu-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    key,
    text: event.text,
    namespace: event.namespace,
    type: event.type ?? '',
    callCount: 0,
    totalSelfTime: 0,
    totalTime: 0,
    avgSelfTime: 0,
    dmlCount: { self: 0, total: 0 },
    soqlCount: { self: 0, total: 0 },
    dmlRowCount: { self: 0, total: 0 },
    soqlRowCount: { self: 0, total: 0 },
    totalThrownCount: 0,
    _children: null,
    instances: [],
    contributionInstances: [],
    originalData: event,
  };
}

function calculateAverages(row: AggregatedRow): void {
  if (row.callCount > 0) {
    row.avgSelfTime = row.totalSelfTime / row.callCount;
  }
}

function calculateBottomUpAverages(row: BottomUpRow): void {
  if (row.callCount > 0) {
    row.avgSelfTime = row.totalSelfTime / row.callCount;
  }
}
