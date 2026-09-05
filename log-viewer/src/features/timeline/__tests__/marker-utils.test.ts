/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for marker extraction (extractMarkers, extractExceptionMarkers).
 */

import { describe, expect, it } from '@jest/globals';
import type { ApexLog, LogEvent, LogIssue } from 'apex-log-parser';
import type { TimelineMarker } from '../types/flamechart.types.js';
import { extractExceptionMarkers, extractMarkers, noDataSpans } from '../utils/marker-utils.js';

function logWith(overrides: Partial<ApexLog>): ApexLog {
  return { logIssues: [], exceptions: [], ...overrides } as unknown as ApexLog;
}

describe('extractMarkers', () => {
  it('copies endTime through for bounded issues', () => {
    const issues: LogIssue[] = [
      {
        startTime: 100,
        endTime: 500,
        summary: 'Skipped-Lines',
        description: 'skipped',
        type: 'skip',
      },
    ];

    const markers = extractMarkers(logWith({ logIssues: issues }));

    expect(markers).toHaveLength(1);
    expect(markers[0]!.type).toBe('skip');
    expect(markers[0]!.startTime).toBe(100);
    expect(markers[0]!.endTime).toBe(500);
  });

  it('leaves endTime undefined for point issues', () => {
    const issues: LogIssue[] = [
      { startTime: 100, summary: 'Unexpected-End', description: '', type: 'unexpected' },
    ];

    const markers = extractMarkers(logWith({ logIssues: issues }));

    expect(markers).toHaveLength(1);
    expect(markers[0]!.endTime).toBeUndefined();
  });

  it('drops error and fatal issues (exceptions cover them)', () => {
    const issues: LogIssue[] = [
      { startTime: 100, summary: 'System.LimitException: cpu', description: '', type: 'fatal' },
      { startTime: 150, summary: 'System.LimitException: soql', description: '', type: 'error' },
      { startTime: 200, summary: 'Skipped-Lines', description: '', type: 'skip' },
    ];

    const markers = extractMarkers(logWith({ logIssues: issues }));

    expect(markers).toHaveLength(1);
    expect(markers[0]!.type).toBe('skip');
  });
});

describe('extractExceptionMarkers', () => {
  it('creates a red point marker per exception event', () => {
    const exceptions = [
      { timestamp: 300, eventIndex: 5, type: 'EXCEPTION_THROWN', text: 'System.NullPointer: x' },
      { timestamp: 800, eventIndex: 9, type: 'FATAL_ERROR', text: 'System.LimitException: cpu' },
    ] as unknown as LogEvent[];

    const markers = extractExceptionMarkers(logWith({ exceptions }));

    expect(markers).toHaveLength(2);
    expect(markers.every((marker) => marker.type === 'exception')).toBe(true);
    expect(markers.every((marker) => marker.endTime === undefined)).toBe(true);
    expect(markers[0]!.startTime).toBe(300);
    expect(markers[0]!.summary).toBe('System.NullPointer: x');
    expect(markers[1]!.eventIndex).toBe(9);
  });

  it('uses the first line as the summary for multi-line exception text', () => {
    const exceptions = [
      { timestamp: 300, eventIndex: 5, type: 'EXCEPTION_THROWN', text: 'first line\nstack\nmore' },
    ] as unknown as LogEvent[];

    const markers = extractExceptionMarkers(logWith({ exceptions }));

    expect(markers[0]!.summary).toBe('first line');
    expect(markers[0]!.metadata).toBe('first line\nstack\nmore');
  });

  it('returns an empty array when there are no exceptions', () => {
    expect(extractExceptionMarkers(logWith({ exceptions: [] }))).toEqual([]);
  });
});

describe('noDataSpans', () => {
  function marker(overrides: Partial<TimelineMarker>): TimelineMarker {
    return {
      id: 'm',
      type: 'skip',
      startTime: 0,
      summary: 'Skipped-Lines',
      ...overrides,
    } as TimelineMarker;
  }

  it('reports a bounded skip as its own range, named by the marker', () => {
    const spans = noDataSpans([
      marker({ startTime: 100, endTime: 500, summary: 'Max-Size-reached' }),
    ]);

    expect(spans).toEqual([{ startTime: 100, endTime: 500, summary: 'Max-Size-reached' }]);
  });

  it('ignores a skip with no end, which is a moment and not a gap', () => {
    expect(noDataSpans([marker({ startTime: 100 })])).toEqual([]);
    expect(noDataSpans([marker({ startTime: 100, endTime: 100 })])).toEqual([]);
  });

  // An exception is a point in recorded time; the log kept running through it.
  it('ignores markers that are not skips', () => {
    const spans = noDataSpans([marker({ type: 'exception', startTime: 100, endTime: 500 })]);

    expect(spans).toEqual([]);
  });

  it('sorts by start time, since the markers are not globally sorted', () => {
    const spans = noDataSpans([
      marker({ startTime: 800, endTime: 900 }),
      marker({ startTime: 100, endTime: 500 }),
    ]);

    expect(spans.map((span) => span.startTime)).toEqual([100, 800]);
  });
});
