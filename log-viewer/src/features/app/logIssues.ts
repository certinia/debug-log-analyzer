/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogIssue as ParsedLogIssue } from '@apexdevtools/apex-log-parser';

import { formatByteSize } from '../../core/utility/Util.js';
import { goToCallTreeAction } from '../call-tree/navigation.js';
import type { IssueSeverity, LogIssue } from '../notifications/types.js';
import { markerTypeForIssue } from '../timeline/types/flamechart.types.js';

const SEVERITY_BY_ISSUE_TYPE: ReadonlyMap<string, IssueSeverity> = new Map([
  ['fatal', 'error'],
  ['error', 'error'],
  ['unexpected', 'warning'],
  // Matches the Analysis notice for the same event: the transaction is sound, the
  // evidence is incomplete. The two surfaces must not grade one truncation twice.
  ['skip', 'warning'],
]);

/**
 * Kind badge for the two exception-shaped issues: a fatal error killed the transaction,
 * a thrown exception may have been caught. Other types self-describe in their summary.
 */
const LABEL_BY_ISSUE_TYPE: ReadonlyMap<string, string> = new Map([
  ['fatal', 'Fatal error'],
  ['error', 'Exception'],
]);

/** Every parsed issue as a card, with each skip stating how much the platform dropped. */
export function toLogIssues(log: ApexLog): LogIssue[] {
  // A `max-size` skip states no figure: the platform stopped writing rather than skipped.
  return log.issues.map((issue) =>
    toLogIssue(
      issue,
      issue.type === 'skip' && issue.skippedBytes !== null
        ? formatByteSize(issue.skippedBytes)
        : undefined,
    ),
  );
}

/**
 * A parsed log issue as a card: severity, rail colour, head, and where activating it goes.
 *
 * `label` overrides the kind badge, for a skip that states its size instead.
 */
export function toLogIssue(issue: ParsedLogIssue, label?: string): LogIssue {
  return {
    summary: issue.summary,
    message: issue.description,
    severity: toSeverity(issue.type),
    label: label ?? LABEL_BY_ISSUE_TYPE.get(issue.type) ?? null,
    action: issue.event ? goToCallTreeAction(issue.event.id) : null,
    // The card's rail is the colour the timeline draws for the same issue.
    category: markerTypeForIssue(issue.type),
    timestamp: issue.startTimestamp,
  };
}

function toSeverity(issueType: ParsedLogIssue['type']): IssueSeverity {
  return SEVERITY_BY_ISSUE_TYPE.get(issueType) || 'info';
}
