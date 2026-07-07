/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';
import { Multiset } from '../../../core/utility/Multiset.js';

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

  // Bucket by type + namespace + text so events of different types (e.g. CODE_UNIT_STARTED
  // vs METHOD_ENTRY) for the same name appear as distinct metrics. The recursion-detection
  // stack key is type-less so a CODE_UNIT_STARTED parent and a METHOD_ENTRY recursive child
  // of the same method are still recognised as the same call stack and totalTime is not
  // double-counted.
  const bucketKey = (node.type ?? '') + '|' + node.namespace + '|' + node.text;
  const stackKey = node.namespace + '|' + node.text;
  let metric = map.get(bucketKey);
  if (!metric) {
    metric = new Metric(node);
    map.set(bucketKey, metric);
  }
  ++metric.count;

  // Only add totalTime if this key is not already on the stack (avoids double counting)
  if (!keyStack.has(stackKey)) {
    metric.totalTime += total;
  }

  metric.selfTime += self;
  metric.nodes.push(node);

  keyStack.add(stackKey);
  for (const child of node.children) {
    addNodeToMap(map, child, keyStack);
  }
  keyStack.remove(stackKey);
}

// Re-export Multiset for backwards compatibility
export { Multiset } from '../../../core/utility/Multiset.js';
