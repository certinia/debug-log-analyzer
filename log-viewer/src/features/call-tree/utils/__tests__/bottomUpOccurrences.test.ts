/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { LogEvent } from 'apex-log-parser';

import { getEventKey as keyOf } from '../Aggregation.js';
import { occurrencesThrough } from '../bottomUpOccurrences.js';

let nextEventIndex = 0;

/** A frame carrying only what a bucket key and an ancestor walk read. */
function frame(text: string, parent: LogEvent | null): LogEvent {
  const event = {
    eventIndex: nextEventIndex++,
    type: 'METHOD_ENTRY',
    namespace: 'default',
    text,
    parent,
    children: [],
  } as unknown as LogEvent;
  parent?.children.push(event);
  return event;
}

// A -> B -> A on one branch, A -> C -> A on the other: the two-level recursion
// the bottom-up root bucket for A holds every occurrence of.
const outer1 = frame('A', null);
const b1 = frame('B', outer1);
const a2 = frame('A', b1);
const outer2 = frame('A', null);
const c1 = frame('C', outer2);
const a3 = frame('A', c1);

const rootInstances = [a2, a3, outer1, outer2];

describe('occurrencesThrough', () => {
  it('reaches every occurrence for a root row', () => {
    expect(occurrencesThrough(rootInstances, [keyOf(outer1)])).toEqual(rootInstances);
  });

  it('reaches the subset a caller row stands for', () => {
    expect(occurrencesThrough(rootInstances, [keyOf(a2), keyOf(b1)])).toEqual([a2]);
    expect(occurrencesThrough(rootInstances, [keyOf(a3), keyOf(c1)])).toEqual([a3]);
  });

  it('follows a two-level recursion up to the outer call', () => {
    expect(occurrencesThrough(rootInstances, [keyOf(a2), keyOf(b1), keyOf(outer1)])).toEqual([a2]);
  });

  it('reaches nothing through a chain no occurrence took', () => {
    expect(occurrencesThrough(rootInstances, [keyOf(a2), keyOf(b1), keyOf(c1)])).toEqual([]);
    // Past the outermost call there is no ancestor left to match.
    expect(
      occurrencesThrough(rootInstances, [keyOf(a2), keyOf(b1), keyOf(outer1), keyOf(b1)]),
    ).toEqual([]);
    expect(occurrencesThrough(rootInstances, ['no such key'])).toEqual([]);
  });

  it('reaches nothing without a path', () => {
    expect(occurrencesThrough(rootInstances, [])).toEqual([]);
  });
});
