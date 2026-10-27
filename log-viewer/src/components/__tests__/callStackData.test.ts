/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

const stack = [
  {
    id: 1,
    type: 'METHOD_ENTRY',
    text: 'run()',
    duration: { total: 41_200_000, self: 2_300_000 },
  },
  {
    id: 2,
    type: 'METHOD_ENTRY',
    text: 'load()',
    duration: { total: 38_900_000, self: 100_000 },
  },
  {
    id: 3,
    type: 'SOQL_EXECUTE_BEGIN',
    text: 'SELECT Id FROM Account',
    duration: { total: 3_100_000, self: 3_100_000 },
  },
];

let currentStack: typeof stack | [] = stack;

jest.mock('#core/log/LogStore.js', () => ({
  currentLogStore: () => ({ stackByEventIndex: () => currentStack }),
}));

import { buildCallStackData } from '../callStackData.js';

describe('buildCallStackData', () => {
  it('maps the stack to plain rows, outermost first, with root total', () => {
    currentStack = stack;
    const { rows, rootTotal } = buildCallStackData(3);
    expect(rows.map((r) => r.eventIndex)).toEqual([1, 2, 3]);
    expect(rows[0]).toEqual({
      eventIndex: 1,
      type: 'METHOD_ENTRY',
      text: 'run()',
      duration: { total: 41_200_000, self: 2_300_000 },
    });
    // rootTotal is the outermost frame's total (denominator for the % bars).
    expect(rootTotal).toBe(41_200_000);
  });

  it('returns empty data for an unset event index', () => {
    currentStack = stack;
    const { rows, rootTotal } = buildCallStackData(-1);
    expect(rows).toEqual([]);
    expect(rootTotal).toBe(0);
  });

  // A limit line's own block was dropped, so the stack skipped the real lineage.
  it('keeps the limit block that holds the selection', () => {
    currentStack = [
      ...stack.slice(0, 2),
      {
        id: 7,
        type: 'CUMULATIVE_LIMIT_USAGE',
        text: 'CUMULATIVE_LIMIT_USAGE',
        duration: { total: 900_000, self: 900_000 },
      },
    ];
    const { rows, rootTotal } = buildCallStackData(8);
    expect(rows.map((r) => r.eventIndex)).toEqual([1, 2, 7]);
    expect(rootTotal).toBe(41_200_000);
  });

  it('handles an empty stack', () => {
    currentStack = [];
    const { rows, rootTotal } = buildCallStackData(3);
    expect(rows).toEqual([]);
    expect(rootTotal).toBe(0);
  });
});
