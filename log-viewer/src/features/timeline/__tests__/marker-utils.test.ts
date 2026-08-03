/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for marker extraction (extractMarkers, extractExceptionMarkers).
 */

import { describe, expect, it } from '@jest/globals';
import type { ApexLog, LogEvent, LogIssue } from 'apex-log-parser';
import { extractExceptionMarkers, extractMarkers } from '../utils/marker-utils.js';

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

  it('drops error issues (exceptions cover them)', () => {
    const issues: LogIssue[] = [
      { startTime: 100, summary: 'FATAL ERROR! cause=boom', description: '', type: 'error' },
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
