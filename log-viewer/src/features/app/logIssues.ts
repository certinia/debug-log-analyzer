/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogIssue as ParsedLogIssue } from 'apex-log-parser';

import { goToCallTreeAction } from '../call-tree/navigation.js';
import type { IssueSeverity, LogIssue } from '../notifications/types.js';
import { markerTypeForIssue } from '../timeline/types/flamechart.types.js';

const SEVERITY_BY_ISSUE_TYPE: ReadonlyMap<string, IssueSeverity> = new Map([
  ['error', 'error'],
  ['unexpected', 'warning'],
  ['skip', 'info'],
]);

/** A parsed log issue as a card: severity, rail colour, head, and where activating it goes. */
export function toLogIssue(issue: ParsedLogIssue): LogIssue {
  return {
    summary: issue.summary,
    message: issue.description,
    severity: toSeverity(issue.type),
    action: issue.eventIndex !== undefined ? goToCallTreeAction(issue.eventIndex) : null,
    // The card's rail is the colour the timeline draws for the same issue.
    category: markerTypeForIssue(issue.type),
    timestamp: issue.startTime || null,
  };
}

function toSeverity(issueType: ParsedLogIssue['type']): IssueSeverity {
  return SEVERITY_BY_ISSUE_TYPE.get(issueType) || 'info';
}
