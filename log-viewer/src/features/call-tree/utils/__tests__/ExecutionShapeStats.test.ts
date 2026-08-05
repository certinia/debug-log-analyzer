/**
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { LogEvent } from 'apex-log-parser';

import { computeExecutionShapeStats } from '../ExecutionShapeStats.js';

type EventOptions = {
  text: string;
  total?: number;
  parent?: LogEvent | null;
  type?: string;
  isParent?: boolean;
  isTruncated?: boolean;
  discontinuity?: boolean;
};

function createEvent(options: EventOptions): LogEvent {
  const event = {
    parent: options.parent ?? null,
    children: [],
    type: (options.type ?? 'METHOD_ENTRY') as LogEvent['type'],
    text: options.text,
    isParent: options.isParent ?? false,
    isTruncated: options.isTruncated ?? false,
    discontinuity: options.discontinuity ?? false,
    duration: { self: 0, total: options.total ?? 0 },
  } as unknown as LogEvent;

  if (options.parent) {
    options.parent.children.push(event);
  }

  return event;
}

describe('computeExecutionShapeStats', () => {
  it('counts every event but only the shown nodes', () => {
    const root = createEvent({ text: 'Root.run()', total: 10 });
    // A zero-cost leaf is a detail row: counted as an event, not a node.
    createEvent({ text: 'debug', total: 0, type: 'USER_DEBUG', parent: root });
    createEvent({ text: 'Root.child()', total: 4, parent: root });

    const stats = computeExecutionShapeStats([root]);

    expect(stats.eventCount).toBe(3);
    expect(stats.nodeCount).toBe(2);
  });

  it('shows a zero-cost node when a descendant is significant, like the details filter', () => {
    const root = createEvent({ text: 'Wrapper.call()', total: 0 });
    createEvent({ text: 'Inner.work()', total: 5, parent: root });

    const stats = computeExecutionShapeStats([root]);

    expect(stats.nodeCount).toBe(2);
    expect(stats.maxDepth).toBe(2);
  });

  it('reports max and mean depth with the deepest node in time order', () => {
    const root = createEvent({ text: 'Root.run()', total: 10 });
    const mid = createEvent({ text: 'Mid.call()', total: 6, parent: root });
    createEvent({ text: 'Deep.first()', total: 2, parent: mid });
    createEvent({ text: 'Deep.second()', total: 2, parent: mid });

    const stats = computeExecutionShapeStats([root]);

    expect(stats.maxDepth).toBe(3);
    // Depths 1 + 2 + 3 + 3 across four nodes.
    expect(stats.meanDepth).toBeCloseTo(2.25);
    expect(stats.deepest).toEqual({ text: 'Deep.first()', depth: 3 });
  });

  it('names the widest fan-out, and the log root when the top level is widest', () => {
    const fanned = createEvent({ text: 'Fan.out()', total: 9 });
    for (let i = 0; i < 3; i++) {
      createEvent({ text: `Fan.child${i}()`, total: 1, parent: fanned });
    }
    expect(computeExecutionShapeStats([fanned]).widest).toEqual({
      text: 'Fan.out()',
      childCount: 3,
    });

    const roots = [1, 2, 3, 4].map((i) => createEvent({ text: `Entry${i}()`, total: 1 }));
    expect(computeExecutionShapeStats(roots).widest).toEqual({ text: null, childCount: 4 });
  });

  it('counts a truncated chain as one region', () => {
    const outer = createEvent({ text: 'Outer.run()', total: 10, isTruncated: true });
    createEvent({ text: 'Inner.run()', total: 5, parent: outer, isTruncated: true });
    const intact = createEvent({ text: 'Intact.run()', total: 3 });

    const stats = computeExecutionShapeStats([outer, intact]);

    expect(stats.truncatedRegionCount).toBe(1);
  });

  it('returns zeros and no paths for an empty tree', () => {
    expect(computeExecutionShapeStats([])).toEqual({
      eventCount: 0,
      nodeCount: 0,
      maxDepth: 0,
      meanDepth: 0,
      truncatedRegionCount: 0,
      deepest: null,
      widest: null,
    });
  });
});
