/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Marker Utilities
 *
 * Helper functions for extracting and validating  markers from ApexLog.
 */

import type { ApexLog } from 'apex-log-parser';
import type { NoDataSpan, TimelineMarker } from '../types/flamechart.types.js';
import { isMarkerType, markerTypeForIssue } from '../types/flamechart.types.js';

/**
 * Extracts markers from ApexLog.logIssues array.
 *
 * Transforms parser's LogIssue format to Marker format for timeline rendering.
 * Validates marker data and filters out invalid entries.
 *
 * Mapping rules:
 * - 'skip' → skip (skipped lines)
 * - 'unexpected' → unexpected (incomplete entries)
 * - 'error' and 'fatal' issues are dropped here: exceptions are surfaced instead via
 *   {@link extractExceptionMarkers}, which covers LimitException/FATAL_ERROR.
 *
 * @param log - Parsed Apex log containing logIssues array
 * @returns Array of validated Marker objects
 */
export function extractMarkers(log: ApexLog): TimelineMarker[] {
  if (!log.logIssues || log.logIssues.length === 0) {
    return [];
  }

  const markers: TimelineMarker[] = [];

  let markerIndex = 0;
  for (const issue of log.logIssues) {
    // Exceptions are drawn from the exception events (see extractExceptionMarkers), so
    // skip any issue on the exception channel here to avoid a duplicated red channel.
    if (markerTypeForIssue(issue.type) === 'exception') {
      continue;
    }

    // Validate type using type guard
    if (!isMarkerType(issue.type)) {
      continue;
    }

    // Validate startTime
    if (issue.startTime === undefined || issue.startTime < 0) {
      continue;
    }

    const marker: TimelineMarker = {
      id: `marker-${markerIndex++}`,
      type: issue.type,
      startTime: issue.startTime,
      endTime: issue.endTime,
      eventIndex: issue.eventIndex,
      summary: issue.summary,
      metadata: issue.description,
    };

    markers.push(marker);
  }

  // Sort by startTime for efficient end time resolution later
  markers.sort((a, b) => a.startTime - b.startTime);

  return markers;
}

/**
 * Extracts exception markers from the parsed log's exception events
 * (EXCEPTION_THROWN and FATAL_ERROR).
 *
 * These are point-in-time markers (no endTime) rendered as red hairlines. The
 * renderer aggregates lines that collapse to the same pixel when zoomed out.
 *
 * @param log - Parsed Apex log containing the exceptions array
 * @returns Array of exception markers in log order
 */
export function extractExceptionMarkers(log: ApexLog): TimelineMarker[] {
  if (!log.exceptions || log.exceptions.length === 0) {
    return [];
  }

  const markers: TimelineMarker[] = [];
  let markerIndex = 0;
  for (const event of log.exceptions) {
    if (event.timestamp < 0) {
      continue;
    }

    const message = event.text || event.type?.toString() || 'Exception';
    markers.push({
      id: `exception-${markerIndex++}`,
      type: 'exception',
      startTime: event.timestamp,
      eventIndex: event.eventIndex,
      summary: message.split('\n', 1)[0] ?? message,
      metadata: message,
    });
  }

  return markers;
}

/**
 * The spans the log recorded nothing in, earliest first.
 *
 * A `skip` marker with an end time is the log saying it stopped between two instants —
 * the size cap, or lines dropped mid-log. Anything measured, such as the governor strip,
 * has no reading in that span and must not carry its last one across it. Markers without
 * an end time are moments, not spans, so they report no gap.
 *
 * @param markers - Markers extracted from the log
 * @returns Spans sorted by start time
 */
export function noDataSpans(markers: TimelineMarker[]): NoDataSpan[] {
  const spans: NoDataSpan[] = [];
  for (const marker of markers) {
    if (marker.type !== 'skip' || marker.endTime === undefined) {
      continue;
    }
    if (marker.endTime > marker.startTime) {
      spans.push({
        startTime: marker.startTime,
        endTime: marker.endTime,
        summary: marker.summary,
      });
    }
  }
  return spans.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Validates a single  marker.
 * Used for runtime validation and testing.
 *
 * @param marker - Marker to validate
 * @returns True if marker is valid, false otherwise
 */
export function validateMarker(marker: TimelineMarker): boolean {
  if (!marker.id) {
    return false;
  }

  if (!isMarkerType(marker.type)) {
    return false;
  }

  if (marker.startTime < 0) {
    return false;
  }

  return true;
}
