/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Tree Converter Utility
 *
 * Converts LogEvent hierarchies to generic TreeNode<EventNode> structures.
 * Enables FlameChart to work with generic event types while maintaining
 * backwards compatibility with existing LogEvent-based code.
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { EventNode, TreeNode } from '../types/flamechart.types.js';

/**
 * Converts LogEvent array to TreeNode array.
 *
 * Recursively traverses event.children to build tree structure.
 * Generates synthetic IDs using timestamp-depth-childIndex to match RectangleManager.
 *
 * @param events - Array of LogEvent objects
 * @param depth - Current depth in tree (0-indexed)
 * @returns TreeNode array with EventNode data
 */
export function logEventToTreeNode(
  events: LogEvent[],
  depth = 0,
): TreeNode<EventNode & { original: LogEvent }>[] {
  return events.map((event, index) => ({
    data: {
      id: `${event.timestamp}-${depth}-${index}`,
      timestamp: event.timestamp,
      duration: event.duration.total,
      type: event.type ?? event.subCategory ?? 'UNKNOWN',
      text: event.text,
      original: event, // Keep reference for backwards compatibility
    },
    children: event.children ? logEventToTreeNode(event.children, depth + 1) : undefined,
    depth,
  }));
}

/**
 * Generates unique ID for event using timestamp and a counter.
 * Used for looking up events in rectMap.
 *
 * Note: This uses a global counter to ensure uniqueness when called multiple times
 * for the same event during rectMap building.
 *
 * @param event - LogEvent to generate ID for
 * @returns Unique string ID
 */
let idCounter = 0;
export function generateEventId(event: LogEvent): string {
  return `${event.timestamp}-${idCounter++}`;
}
