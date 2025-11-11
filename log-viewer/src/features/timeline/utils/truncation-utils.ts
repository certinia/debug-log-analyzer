/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Truncation Utilities
 *
 * Helper functions for extracting and validating truncation markers from ApexLog.
 */

import type { ApexLog } from '../../../core/log-parser/LogEvents.js';
import type { TruncationMarker } from '../types/timeline.types.js';
import { isTruncationType } from '../types/timeline.types.js';

/**
 * Extracts truncation markers from ApexLog.logIssues array.
 *
 * Transforms parser's LogIssue format to TruncationMarker format for timeline rendering.
 * Validates marker data and filters out invalid entries.
 *
 * Mapping rules:
 * - 'skip' → skip (skipped lines)
 * - 'unexpected' → unexpected (incomplete entries)
 * - 'error' → error (system errors)
 *
 * @param log - Parsed Apex log containing logIssues array
 * @returns Array of validated TruncationMarker objects
 */
export function extractTruncationMarkers(log: ApexLog): TruncationMarker[] {
  if (!log.logIssues || log.logIssues.length === 0) {
    return [];
  }

  const markers: TruncationMarker[] = [];

  for (const issue of log.logIssues) {
    // Validate type using type guard
    if (!isTruncationType(issue.type)) {
      continue;
    }

    // Validate startTime
    if (issue.startTime === undefined || issue.startTime < 0) {
      continue;
    }

    // Create TruncationMarker
    const marker: TruncationMarker = {
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
 * Validates a single truncation marker.
 * Used for runtime validation and testing.
 *
 * @param marker - Marker to validate
 * @returns True if marker is valid, false otherwise
 */
export function validateTruncationMarker(marker: TruncationMarker): boolean {
  if (!isTruncationType(marker.type)) {
    return false;
  }

  if (marker.startTime < 0) {
    return false;
  }

  return true;
}
