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
      [999_000_000, '999.00ms'],
      [1_000_000_000, '1.00s'],
      [1_500_000_000, '1.50s'],
      [30_000_000_000, '30.00s'],
      [59_990_000_000, '59.99s'],
      [60_000_000_000, '1m 0.00s'],
      [90_000_000_000, '1m 30.00s'],
      [150_000_000_000, '2m 30.00s'],
      [600_000_000_000, '10m 0.00s'],
    ])('formats %d ns as %s', (ns, expected) => {
      expect(formatDuration(ns)).toBe(expected);
    });

    it.each([
      [123_456_789, '123.46ms'],
      [61_234_567_890, '1m 1.23s'],
    ])('rounds %d ns to two decimal places, giving %s', (ns, expected) => {
      expect(formatDuration(ns)).toBe(expected);
    });
  });

  describe('TIMESTAMP_REGEX', () => {
    it.each([
      ['09:45:31.888 (38889007737)|METHOD_ENTRY', '38889007737'],
      ['12:00:00.000 (1000)|CODE_UNIT_STARTED', '1000'],
      ['23:59:59.999 (999999999999)|SOQL_EXECUTE_BEGIN', '999999999999'],
      ['00:00:00.001 (1)|DML_BEGIN', '1'],
      // One decimal place, not three.
      ['10:30:45.1 (12345)|EXECUTION_STARTED', '12345'],
    ])('captures the nanoseconds of %s', (line, expected) => {
      expect(line.match(TIMESTAMP_REGEX)?.[1]).toBe(expected);
    });

    it.each([
      'This is just some text',
      // A single-digit hour.
      '9:45:31.888 (38889007737)|METHOD_ENTRY',
      '09:45:31.888 (38889007737) METHOD_ENTRY',
      // Anchored, so a timestamp that does not start the line is not one.
      'prefix 09:45:31.888 (38889007737)|METHOD_ENTRY',
      '',
    ])('does not match %p', (line) => {
      expect(line.match(TIMESTAMP_REGEX)).toBeNull();
    });
  });

  describe('buildMetricParts', () => {
    describe('duration formatting', () => {
      it('should include total duration when self equals total', () => {
        const event = createMockLogEvent({
          duration: { self: 1_000_000_000, total: 1_000_000_000 },
        });

        const parts = buildMetricParts(event);

        expect(parts[0]).toBe('**1.00s**');
      });

      it('should include self time when different from total', () => {
        const event = createMockLogEvent({
          duration: { self: 500_000_000, total: 1_000_000_000 },
        });

        const parts = buildMetricParts(event);

        expect(parts[0]).toBe('**1.00s** (self: 500.00ms)');
      });

      it('should format zero duration', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
        });

        const parts = buildMetricParts(event);

        expect(parts[0]).toBe('**0.00ms**');
      });
    });

    describe('SOQL metrics', () => {
      it('should include SOQL count when present', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          soqlCount: { self: 0, total: 5 },
        });

        const parts = buildMetricParts(event);

        expect(parts).toContain('5 SOQL');
      });

      it('should include SOQL self count when non-zero', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          soqlCount: { self: 2, total: 5 },
        });

        const parts = buildMetricParts(event);

        expect(parts).toContain('5 SOQL (self: 2)');
      });

      it('should not include SOQL when count is zero', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          soqlCount: { self: 0, total: 0 },
        });

        const parts = buildMetricParts(event);

        expect(parts.some((p) => p.includes('SOQL'))).toBe(false);
      });

      it('should include SOQL row count when present', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          soqlRowCount: { self: 0, total: 100 },
        });

        const parts = buildMetricParts(event);

        expect(parts).toContain('100 rows');
      });

      it('should not include SOQL rows when zero', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          soqlRowCount: { self: 0, total: 0 },
        });

        const parts = buildMetricParts(event);

        expect(parts.some((p) => p.includes('rows'))).toBe(false);
      });
    });

    describe('DML metrics', () => {
      it('should include DML count when present', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          dmlCount: { self: 0, total: 3 },
        });

        const parts = buildMetricParts(event);

        expect(parts).toContain('3 DML');
      });

      it('should include DML self count when non-zero', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          dmlCount: { self: 1, total: 3 },
        });

        const parts = buildMetricParts(event);

        expect(parts).toContain('3 DML (self: 1)');
      });

      it('should not include DML when count is zero', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          dmlCount: { self: 0, total: 0 },
        });

        const parts = buildMetricParts(event);

        expect(parts.some((p) => p.includes('DML'))).toBe(false);
      });

      it('should include DML row count when present', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          dmlRowCount: { self: 0, total: 50 },
        });

        const parts = buildMetricParts(event);

        expect(parts).toContain('50 DML rows');
      });

      it('should not include DML rows when zero', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          dmlRowCount: { self: 0, total: 0 },
        });

        const parts = buildMetricParts(event);

        expect(parts.some((p) => p.includes('DML rows'))).toBe(false);
      });
    });

    describe('exception metrics', () => {
      it('should include thrown count when present', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          thrownCount: { self: 2, total: 2 },
        });

        const parts = buildMetricParts(event);

        expect(parts.some((p) => p.includes('2 thrown'))).toBe(true);
      });

      it('should not include thrown when zero', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          thrownCount: { self: 0, total: 0 },
        });

        const parts = buildMetricParts(event);

        expect(parts.some((p) => p.includes('thrown'))).toBe(false);
      });

      it('should include warning emoji for exceptions', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          thrownCount: { self: 1, total: 1 },
        });

        const parts = buildMetricParts(event);

        expect(parts.some((p) => p.includes('\u26a0\ufe0f'))).toBe(true);
      });
    });

    describe('combined metrics', () => {
      it('should include all metrics in correct order', () => {
        const event = createMockLogEvent({
          duration: { self: 500_000_000, total: 1_000_000_000 },
          soqlCount: { self: 1, total: 5 },
          soqlRowCount: { self: 0, total: 100 },
          dmlCount: { self: 1, total: 3 },
          dmlRowCount: { self: 0, total: 50 },
          thrownCount: { self: 1, total: 1 },
        });

        const parts = buildMetricParts(event);

        expect(parts.length).toBe(6);
        expect(parts[0]).toContain('1.00s');
        expect(parts[1]).toContain('SOQL');
        expect(parts[2]).toContain('rows');
        expect(parts[3]).toContain('DML');
        expect(parts[4]).toContain('DML rows');
        expect(parts[5]).toContain('thrown');
      });

      it('should handle event with only duration', () => {
        const event = createMockLogEvent({
          duration: { self: 100_000_000, total: 100_000_000 },
          soqlCount: { self: 0, total: 0 },
          soqlRowCount: { self: 0, total: 0 },
          dmlCount: { self: 0, total: 0 },
          dmlRowCount: { self: 0, total: 0 },
          thrownCount: { self: 0, total: 0 },
        });

        const parts = buildMetricParts(event);

        expect(parts.length).toBe(1);
        expect(parts[0]).toBe('**100.00ms**');
      });
    });
  });
});
