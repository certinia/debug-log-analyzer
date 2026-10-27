/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  type ApexEvent,
  type EventOf,
  type EventType,
  eventType,
  type FlowType,
  type GovernorLimits,
  type SelfTotal,
} from '@apexdevtools/apex-log-parser';

import { formatDuration } from '#core/utility/Util.js';
import { SOSL_ROWS_PER_QUERY_LIMIT } from '../../database/limits.js';

/** What a frame's name gains to tell it from a method of the same text. */
const SUFFIX: Partial<Record<EventType, string>> = {
  CONSTRUCTOR_ENTRY: ' (constructor)',
  SYSTEM_CONSTRUCTOR_ENTRY: ' (system constructor)',
  CODE_UNIT_STARTED: ' (code unit)',
  VF_APEX_CALL_START: ' (VF APEX)',
  VF_EVALUATE_FORMULA_BEGIN: ' (VF FORMULA)',
  ENTERING_MANAGED_PKG: ' (managed package)',
  FLOW_START_INTERVIEW_BEGIN: ' (flow)',
};

const FLOW_SUFFIX: Record<FlowType, string> = {
  flow: ' (Flow)',
  'process-builder': ' (Process Builder)',
};

function suffixOf(event: ApexEvent): string {
  if (event.type === 'FLOW_START_INTERVIEWS_BEGIN') {
    const { flowType } = (event as EventOf<'FLOW_START_INTERVIEWS_BEGIN'>).details;
    return flowType ? FLOW_SUFFIX[flowType] : '';
  }
  return SUFFIX[event.type] ?? '';
}

/** The frame's display name: its text, or its type where it states none, and its suffix. */
export function eventName(event: ApexEvent): string {
  return `${event.text ?? event.type}${suffixOf(event)}`;
}

/**
 * True when the text says nothing on its own: absent, or a lone boolean or
 * number. Those are the only frames whose raw event type earns a place in the
 * label — for everything else the text (plus the parser's suffix) already
 * identifies the frame, and prefixing it just adds a word to read.
 */
function isBareText(text: string): boolean {
  return text === 'true' || text === 'false' || /^-?\d+$/.test(text);
}

/**
 * The frame's label for a tree cell: {@link eventName}, falling back to the raw
 * event type where the text can't stand alone. Text that already repeats the
 * type stands alone — prefixing it would read `EXECUTION_STARTED: EXECUTION_STARTED`.
 */
export function eventLabel(event: ApexEvent): string {
  const name = eventName(event);
  if (event.text === null || !isBareText(event.text) || event.text === event.type) {
    return name;
  }
  return `${event.type}: ${name}`;
}

/**
 * Plain-text details for a frame — name, type, duration and any non-zero
 * governor metrics. Shared by the timeline's and the inspector's
 * "Copy Details" actions so both put identical text on the clipboard.
 */
export function formatEventDetails(event: ApexEvent, limits?: GovernorLimits): string {
  const lines: string[] = [`Name: ${eventName(event)}`, `Type: ${event.type}`];

  if (event.isFrame && event.duration.total) {
    let duration = formatDuration(event.duration.total);
    if (!eventType(event.type).consumesCpuTime) {
      duration += ' (free)';
    } else if (event.duration.self) {
      duration += ` (self ${formatDuration(event.duration.self)})`;
    }
    lines.push(`Duration: ${duration}`);
  }

  const metrics: [string, SelfTotal | null, number | null | undefined][] = [
    ['DML', event.dmlCount, limits?.final.dmlStatements.limit],
    ['DML Rows', event.dmlRowCount, limits?.final.dmlRows.limit],
    ['SOQL', event.soqlCount, limits?.final.soqlQueries.limit],
    ['SOQL Rows', event.soqlRowCount, limits?.final.queryRows.limit],
    ['SOSL', event.soslCount, limits?.final.soslQueries.limit],
    // SOSL rows have no cumulative transaction limit — only a per-query cap,
    // so it is a meaningful denominator for a SOSL statement and nothing else.
    [
      'SOSL Rows',
      event.soslRowCount,
      event.type === 'SOSL_EXECUTE_BEGIN' ? SOSL_ROWS_PER_QUERY_LIMIT : undefined,
    ],
  ];
  for (const [label, metric, limit] of metrics) {
    if (metric?.total) {
      lines.push(`${label}: ${formatLimit(metric, limit)}`);
    }
  }

  return lines.join('\n');
}

/** The lineage of frames that led to `event`, outermost first, one per line. */
export function formatCallStack(event: ApexEvent): string {
  const stack: ApexEvent[] = [];
  for (let current: ApexEvent | null = event; current; current = current.parent) {
    stack.unshift(current);
  }
  return stack.map(eventName).join('\n');
}

function formatLimit(metric: SelfTotal, limit?: number | null): string {
  const outOf = limit ? `/${limit}` : '';
  return `${metric.total}${outOf} (self ${metric.self})`;
}
