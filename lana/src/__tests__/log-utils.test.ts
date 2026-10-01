/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { buildMetricParts, formatDuration, TIMESTAMP_REGEX } from '../log-utils.js';
import { createMockLogEvent } from './helpers/test-builders.js';

describe('log-utils', () => {
  describe('formatDuration', () => {
    // The unit steps at 1s and at 60s, so the rows either side of each are the ones
    // that matter.
    it.each([
      [0, '0.00ms'],
      [500_000, '0.50ms'],
      [1_000_000, '1.00ms'],
      [123_456_789, '123.46ms'],
      [999_000_000, '999.00ms'],
      [1_000_000_000, '1.00s'],
      [1_500_000_000, '1.50s'],
      [30_000_000_000, '30.00s'],
      [59_990_000_000, '59.99s'],
      [60_000_000_000, '1m 0.00s'],
      [61_234_567_890, '1m 1.23s'],
      [90_000_000_000, '1m 30.00s'],
      [150_000_000_000, '2m 30.00s'],
      [600_000_000_000, '10m 0.00s'],
    ])('formats %d ns as %s', (ns, expected) => {
      expect(formatDuration(ns)).toBe(expected);
    });
  });

  describe('TIMESTAMP_REGEX', () => {
    it.each([
      ['09:45:31.888 (38889007737)|METHOD_ENTRY', '38889007737'],
      ['12:00:00.000 (1000)|CODE_UNIT_STARTED', '1000'],
      ['23:59:59.999 (999999999999)|SOQL_EXECUTE_BEGIN', '999999999999'],
      ['00:00:00.001 (1)|DML_BEGIN', '1'],
      ['10:30:45.1 (12345)|EXECUTION_STARTED', '12345'],
    ])('captures the nanoseconds of %s', (line, expected) => {
      expect(line.match(TIMESTAMP_REGEX)?.[1]).toBe(expected);
    });

    it.each([
      ['a line carrying no timestamp', 'This is just some text'],
      ['a single-digit hour', '9:45:31.888 (38889007737)|METHOD_ENTRY'],
      ['no pipe after the nanoseconds', '09:45:31.888 (38889007737) METHOD_ENTRY'],
      [
        'a timestamp that does not start the line',
        'prefix 09:45:31.888 (38889007737)|METHOD_ENTRY',
      ],
      ['an empty line', ''],
    ])('does not match %s', (_reason, line) => {
      expect(line.match(TIMESTAMP_REGEX)).toBeNull();
    });
  });

  describe('buildMetricParts', () => {
    it.each([
      [1_000_000_000, 1_000_000_000, '**1.00s**'],
      [100_000_000, 100_000_000, '**100.00ms**'],
      [0, 0, '**0.00ms**'],
      [500_000_000, 1_000_000_000, '**1.00s** (self: 500.00ms)'],
    ])('leads with self %d ns of total %d ns as %s', (self, total, expected) => {
      expect(buildMetricParts(createMockLogEvent({ duration: { self, total } }))).toEqual([
        expected,
      ]);
    });

    it.each([
      ['soqlCount', 0, 5, '5 SOQL'],
      ['soqlCount', 2, 5, '5 SOQL (self: 2)'],
      ['soqlRowCount', 0, 100, '100 rows'],
      ['dmlCount', 0, 3, '3 DML'],
      ['dmlCount', 1, 3, '3 DML (self: 1)'],
      ['dmlRowCount', 0, 50, '50 DML rows'],
      ['thrownCount', 2, 2, '⚠️ 2 thrown'],
    ])('adds %s self %d of %d as %s', (field, self, total, expected) => {
      const event = createMockLogEvent({
        duration: { self: 0, total: 0 },
        [field]: { self, total },
      });

      expect(buildMetricParts(event)).toEqual(['**0.00ms**', expected]);
    });

    it.each(['soqlCount', 'soqlRowCount', 'dmlCount', 'dmlRowCount', 'thrownCount'])(
      'omits %s when it is zero',
      (field) => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          [field]: { self: 0, total: 0 },
        });

        expect(buildMetricParts(event)).toEqual(['**0.00ms**']);
      },
    );

    it('orders every metric after the duration', () => {
      const event = createMockLogEvent({
        duration: { self: 500_000_000, total: 1_000_000_000 },
        soqlCount: { self: 1, total: 5 },
        soqlRowCount: { self: 0, total: 100 },
        dmlCount: { self: 1, total: 3 },
        dmlRowCount: { self: 0, total: 50 },
        thrownCount: { self: 1, total: 1 },
      });

      expect(buildMetricParts(event)).toEqual([
        '**1.00s** (self: 500.00ms)',
        '5 SOQL (self: 1)',
        '100 rows',
        '3 DML (self: 1)',
        '50 DML rows',
        '⚠️ 1 thrown',
      ]);
    });
  });
});
