/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents';

/**
 * Represents aggregated metrics for a specific method or function across multiple invocations.
 * Tracks execution count, timing information, and references to all log events for this method.
 */
export class Metric {
  /** The name of the method or function */
  name: string;
  /** The type of the log event (e.g., METHOD_ENTRY, CONSTRUCTOR_ENTRY) */
  type;
  /** The number of times this method was invoked */
  count = 0;
  /** Total execution time across all invocations in nanoseconds (excludes recursive double-counting) */
  totalTime = 0;
  /** Self time (time excluding child calls) across all invocations in nanoseconds */
  selfTime = 0;
  /** The namespace or package containing this method */
  namespace;
  /** Array of all log events corresponding to this method's invocations */
  nodes: LogEvent[] = [];

  constructor(node: LogEvent) {
    this.name = node.text;
    this.type = node.type;
    this.namespace = node.namespace;
  }
}

/**
 * Groups log events by method name and namespace, aggregating metrics for each unique method.
 * Handles recursive calls by tracking the call stack to avoid double-counting execution time.
 *
 * @param root - The root log event containing the execution tree to analyze
 * @returns An array of Metric objects, one per unique method (namespace + name combination)
 *
 * @example
 * ```typescript
 * const metrics = group(rootLogEvent);
 * // Returns [
 * //   { name: "processData", count: 5, totalTime: 1000000, selfTime: 500000, ... },
 * //   { name: "validateInput", count: 3, totalTime: 200000, selfTime: 200000, ... }
 * // ]
 * ```
 */
export function group(root: LogEvent) {
  const methodMap: Map<string, Metric> = new Map();
  const keyStack = new Multiset<string>();

  for (const child of root.children) {
    addNodeToMap(methodMap, child, keyStack);
  }
  return Array.from(methodMap.values());
}

/**
 * Recursively processes a log event node and its children, aggregating metrics by method identity.
 * Uses a multiset to track the current call stack and prevent double-counting of recursive invocations.
 *
 * @param map - Map storing aggregated metrics, keyed by namespace + method name
 * @param node - The current log event node to process
 * @param keyStack - Multiset tracking the current call stack to detect recursive calls
 *
 * @remarks
 * - Skips nodes with no duration and no children (leaf nodes with no execution time)
 * - Uses namespace + name as the unique key for grouping methods
 * - For recursive calls (same method appearing multiple times in the call stack),
 *   only the outermost invocation's totalTime is counted to avoid double-counting
 * - selfTime is always accumulated regardless of recursion
 */
function addNodeToMap(map: Map<string, Metric>, node: LogEvent, keyStack: Multiset<string>) {
  const { self, total } = node.duration;
  // Exclude nodes without a duration and no children
  if (!total && !node.children.length) {
    return;
  }

  // We want to process all nodes even if duration is 0 so that the count is accurate e.g we could have many method calls of 0 duraion (even if unlikely)
  const key = node.namespace + node.text;
  let metric = map.get(key);
  if (!metric) {
    metric = new Metric(node);
    map.set(key, metric);
  }
  ++metric.count;

  // Only add totalTime if this key is not already on the stack (avoids double counting)
  if (!keyStack.has(key)) {
    metric.totalTime += total;
  }

  metric.selfTime += self;
  metric.nodes.push(node);

  keyStack.add(key);
  for (const child of node.children) {
    addNodeToMap(map, child, keyStack);
  }
  keyStack.remove(key);
}

/**
 * A slimmed down multiset (bag) data structure that allows duplicate elements and tracks their count.
 * Provides O(1) add, remove, and has operations.
 * Note: This could easily be extended to a full multiset implementation and count() functione etc if needed in the future.
 */
export class Multiset<T> {
  private map: Map<T, number> = new Map();

  /**
   * Adds an element to the multiset.
   * @param element - The element to add
   * @returns The new count of this element
   */
  add(element: T): number {
    const count = (this.map.get(element) ?? 0) + 1;
    this.map.set(element, count);
    return count;
  }

  /**
   * Removes one occurrence of an element from the multiset.
   * @param element - The element to remove
   * @returns True if an element was removed, false if element was not in the multiset
   */
  remove(element: T): boolean {
    const count = this.map.get(element);
    if (count === undefined) {
      return false;
    }

    if (count === 1) {
      this.map.delete(element);
    } else {
      this.map.set(element, count - 1);
    }
    return true;
  }

  /**
   * Checks if the multiset contains at least one occurrence of an element.
   * @param element - The element to check
   * @returns True if the element is in the multiset
   */
  has(element: T): boolean {
    return this.map.has(element);
  }
}
