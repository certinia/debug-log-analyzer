/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { buildMetricParts, formatDuration, TIMESTAMP_REGEX } from '../log-utils.js';
import { createMockLogEvent } from './helpers/test-builders.js';

describe('log-utils', () => {
  describe('formatDuration', () => {
    describe('milliseconds (< 1 second)', () => {
      it('should format nanoseconds as milliseconds for small values', () => {
        expect(formatDuration(1_000_000)).toBe('1.00ms');
      });

      it('should format sub-millisecond values', () => {
        expect(formatDuration(500_000)).toBe('0.50ms');
      });

      it('should format zero duration', () => {
        expect(formatDuration(0)).toBe('0.00ms');
      });

      it('should format values just under 1 second', () => {
        expect(formatDuration(999_000_000)).toBe('999.00ms');
      });

      it('should format with 2 decimal places', () => {
        expect(formatDuration(123_456_789)).toBe('123.46ms');
      });
    });

    describe('seconds (1-60 seconds)', () => {
      it('should format exactly 1 second', () => {
        expect(formatDuration(1_000_000_000)).toBe('1.00s');
      });

      it('should format seconds with decimals', () => {
        expect(formatDuration(1_500_000_000)).toBe('1.50s');
      });

      it('should format values just under 60 seconds', () => {
        expect(formatDuration(59_990_000_000)).toBe('59.99s');
      });

      it('should format 30 seconds', () => {
        expect(formatDuration(30_000_000_000)).toBe('30.00s');
      });
    });

    describe('minutes (>= 60 seconds)', () => {
      it('should format exactly 1 minute', () => {
        expect(formatDuration(60_000_000_000)).toBe('1m 0.00s');
      });

      it('should format 1 minute and 30 seconds', () => {
        expect(formatDuration(90_000_000_000)).toBe('1m 30.00s');
      });

      it('should format multiple minutes', () => {
        expect(formatDuration(150_000_000_000)).toBe('2m 30.00s');
      });

      it('should format large duration', () => {
        expect(formatDuration(600_000_000_000)).toBe('10m 0.00s');
      });

      it('should format minutes with fractional seconds', () => {
        expect(formatDuration(61_234_567_890)).toBe('1m 1.23s');
      });
    });
  });

  describe('TIMESTAMP_REGEX', () => {
    describe('valid timestamps', () => {
      it('should match standard timestamp format', () => {
        const line = '09:45:31.888 (38889007737)|METHOD_ENTRY';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).not.toBeNull();
        expect(match?.[1]).toBe('38889007737');
      });

      it('should match timestamp at start of log line', () => {
        const line = '12:00:00.000 (1000)|CODE_UNIT_STARTED';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).not.toBeNull();
        expect(match?.[1]).toBe('1000');
      });

      it('should match timestamp with long nanoseconds', () => {
        const line = '23:59:59.999 (999999999999)|SOQL_EXECUTE_BEGIN';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).not.toBeNull();
        expect(match?.[1]).toBe('999999999999');
      });

      it('should match timestamp with short nanoseconds', () => {
        const line = '00:00:00.001 (1)|DML_BEGIN';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).not.toBeNull();
        expect(match?.[1]).toBe('1');
      });

      it('should match timestamp with varying decimal precision', () => {
        const line = '10:30:45.1 (12345)|EXECUTION_STARTED';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).not.toBeNull();
        expect(match?.[1]).toBe('12345');
      });

      it('should match timestamp with space before parentheses', () => {
        const line = '09:45:31.888 (38889007737)|METHOD_ENTRY';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).not.toBeNull();
      });
    });

    describe('invalid timestamps', () => {
      it('should not match line without timestamp', () => {
        const line = 'This is just some text';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).toBeNull();
      });

      it('should not match malformed time', () => {
        const line = '9:45:31.888 (38889007737)|METHOD_ENTRY';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).toBeNull();
      });

      it('should not match timestamp without pipe', () => {
        const line = '09:45:31.888 (38889007737) METHOD_ENTRY';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).toBeNull();
      });

      it('should not match timestamp in middle of line', () => {
        const line = 'prefix 09:45:31.888 (38889007737)|METHOD_ENTRY';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).toBeNull();
      });

      it('should not match empty string', () => {
        const line = '';
        const match = line.match(TIMESTAMP_REGEX);

        expect(match).toBeNull();
      });
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
          totalThrownCount: 2,
        });

        const parts = buildMetricParts(event);

        expect(parts.some((p) => p.includes('2 thrown'))).toBe(true);
      });

      it('should not include thrown when zero', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          totalThrownCount: 0,
        });

        const parts = buildMetricParts(event);

        expect(parts.some((p) => p.includes('thrown'))).toBe(false);
      });

      it('should include warning emoji for exceptions', () => {
        const event = createMockLogEvent({
          duration: { self: 0, total: 0 },
          totalThrownCount: 1,
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
          totalThrownCount: 1,
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
          totalThrownCount: 0,
        });

        const parts = buildMetricParts(event);

        expect(parts.length).toBe(1);
        expect(parts[0]).toBe('**100.00ms**');
      });
    });
  });
});
