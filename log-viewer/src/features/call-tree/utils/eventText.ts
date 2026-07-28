/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits, LogEvent } from 'apex-log-parser';

import { formatDuration } from '../../../core/utility/Util.js';

/** The frame's display name, including any parser-supplied suffix. */
export function eventName(event: LogEvent): string {
  return `${event.text}${event.suffix ?? ''}`;
}

/**
 * Plain-text details for a frame — name, type, duration and any non-zero
 * governor metrics. Shared by the timeline's and the detail side bar's
 * "Copy Details" actions so both put identical text on the clipboard.
 */
export function formatEventDetails(event: LogEvent, limits?: GovernorLimits): string {
  const lines: string[] = [`Name: ${eventName(event)}`];

  if (event.type) {
    lines.push(`Type: ${event.type}`);
  }

  if (event.exitStamp && event.duration.total) {
    let duration = formatDuration(event.duration.total);
    if (event.cpuType === 'free') {
      duration += ' (free)';
    } else if (event.duration.self) {
      duration += ` (self ${formatDuration(event.duration.self)})`;
    }
    lines.push(`Duration: ${duration}`);
  }

  const metrics: [string, { total: number; self: number }, number | undefined][] = [
    ['DML', event.dmlCount, limits?.dmlStatements.limit],
    ['DML Rows', event.dmlRowCount, limits?.dmlRows.limit],
    ['SOQL', event.soqlCount, limits?.soqlQueries.limit],
    ['SOQL Rows', event.soqlRowCount, limits?.queryRows.limit],
    ['SOSL', event.soslCount, limits?.soslQueries.limit],
    ['SOSL Rows', event.soslRowCount, limits?.soslQueries.limit],
  ];
  for (const [label, metric, limit] of metrics) {
    if (metric.total) {
      lines.push(`${label}: ${formatLimit(metric, limit)}`);
    }
  }

  return lines.join('\n');
}

/** The lineage of frames that led to `event`, outermost first, one per line. */
export function formatCallStack(event: LogEvent): string {
  const stack: LogEvent[] = [];
  let current: LogEvent | null = event;
  while (current?.type) {
    stack.unshift(current);
    current = current.parent;
  }
  return stack.map(eventName).join('\n');
}

function formatLimit(metric: { total: number; self: number }, limit?: number): string {
  const outOf = limit ? `/${limit}` : '';
  return `${metric.total}${outOf} (self ${metric.self})`;
}
