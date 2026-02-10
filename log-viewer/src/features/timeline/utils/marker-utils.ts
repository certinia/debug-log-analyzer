/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Marker Utilities
 *
 * Helper functions for extracting and validating  markers from ApexLog.
 */

import type { ApexLog } from 'apex-log-parser';
import type { TimelineMarker } from '../types/flamechart.types.js';
import { isMarkerType } from '../types/flamechart.types.js';

/**
 * Extracts markers from ApexLog.logIssues array.
 *
 * Transforms parser's LogIssue format to Marker format for timeline rendering.
 * Validates marker data and filters out invalid entries.
 *
 * Mapping rules:
 * - 'skip' → skip (skipped lines)
 * - 'unexpected' → unexpected (incomplete entries)
 * - 'error' → error (system errors)
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
