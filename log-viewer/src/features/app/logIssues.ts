/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';
import type { LogIssue as ParsedLogIssue } from '@apexdevtools/apex-log-parser/types';

import { formatByteSize } from '../../core/utility/Util.js';
import { goToCallTreeAction } from '../call-tree/navigation.js';
import type { IssueSeverity, LogIssue } from '../notifications/types.js';
import { markerTypeForIssue } from '../timeline/types/flamechart.types.js';

const SEVERITY_BY_ISSUE_TYPE: ReadonlyMap<string, IssueSeverity> = new Map([
  ['fatal', 'error'],
  ['error', 'error'],
  ['unexpected', 'warning'],
  ['skip', 'info'],
]);

/**
 * Kind badge for the two exception-shaped issues: a fatal error killed the transaction,
 * a thrown exception may have been caught. Other types self-describe in their summary.
 */
const LABEL_BY_ISSUE_TYPE: ReadonlyMap<string, string> = new Map([
  ['fatal', 'Fatal error'],
  ['error', 'Exception'],
]);

/**
 * Every parsed issue as a card, with each skip stating how much the platform dropped.
 *
 * `truncation.regions` and the `skip` issues are the same events twice — one region per
 * issue, in log order — so the figure is joined back on `eventIndex` rather than reread
 * from the issue's prose.
 */
export function toLogIssues(log: ApexLog): LogIssue[] {
  const skippedBytes = new Map<number, number>();
  for (const region of log.truncation.regions) {
    // A `max-size` region states no figure: the platform stopped writing rather than skipped.
    if (region.eventIndex !== undefined && region.skippedBytes !== undefined) {
      skippedBytes.set(region.eventIndex, region.skippedBytes);
    }
  }
  return log.logIssues.map((issue) => {
    const card = toLogIssue(issue);
    const bytes = issue.eventIndex !== undefined ? skippedBytes.get(issue.eventIndex) : undefined;
    return bytes === undefined ? card : { ...card, label: formatByteSize(bytes) };
  });
}

/** A parsed log issue as a card: severity, rail colour, head, and where activating it goes. */
export function toLogIssue(issue: ParsedLogIssue): LogIssue {
  return {
    summary: issue.summary,
    message: issue.description,
    severity: toSeverity(issue.type),
    label: LABEL_BY_ISSUE_TYPE.get(issue.type) || null,
    action: issue.eventIndex !== undefined ? goToCallTreeAction(issue.eventIndex) : null,
    // The card's rail is the colour the timeline draws for the same issue.
    category: markerTypeForIssue(issue.type),
    timestamp: issue.startTime ?? null,
  };
}

function toSeverity(issueType: ParsedLogIssue['type']): IssueSeverity {
  return SEVERITY_BY_ISSUE_TYPE.get(issueType) || 'info';
}
