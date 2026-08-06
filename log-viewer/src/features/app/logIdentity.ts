/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { CodeUnitStartedLine, ExecutionStartedLine, type ApexLog } from 'apex-log-parser';

import { formatWallClockTime } from '../../core/utility/Util.js';

/** One header identity item: `label` is the compact display text, `detail` the tooltip. */
export interface LogIdentityItem {
  label: string;
  detail: string;
}

/** The transaction identity shown in the header: what ran, who ran it, and when. */
export interface LogIdentityData {
  entryPoint: LogIdentityItem | null;
  user: LogIdentityItem | null;
  startTime: LogIdentityItem | null;
}

/**
 * Derives the header identity from a parsed log. `rawLog` is needed for the user:
 * parsing starts at `EXECUTION_STARTED`, so the `USER_INFO` line before it never
 * becomes an event. TODO(spike): hoist USER_INFO onto `ApexLog` in the parser and
 * drop the raw-text scan.
 */
export function deriveLogIdentity(log: ApexLog, rawLog: string): LogIdentityData {
  const userInfo = parseUserInfo(rawLog);
  return {
    entryPoint: entryPointItem(log),
    user: userInfo
      ? { label: userInfo.username.split('@')[0] || userInfo.username, detail: userInfo.username }
      : null,
    // The timezone sits with the time, not the user: the log's timestamps are
    // rendered in that zone, so it qualifies the clock reading.
    startTime: startTimeItem(log, userInfo?.timezone),
  };
}

function entryPointItem(log: ApexLog): LogIdentityItem | null {
  const unit = firstCodeUnit(log);
  return unit ? { label: entryPointLabel(unit), detail: unit.text } : null;
}

/**
 * The first `CODE_UNIT_STARTED` stands in for the request's operation, the same
 * field Salesforce's own debug-log list calls "Operation". It is usually nested
 * under `EXECUTION_STARTED`, but sits at the root when that marker is absent.
 */
function firstCodeUnit(log: ApexLog): CodeUnitStartedLine | null {
  for (const child of log.children) {
    if (child instanceof CodeUnitStartedLine) {
      return child;
    }
    if (child instanceof ExecutionStartedLine) {
      const unit = child.children.find((c) => c instanceof CodeUnitStartedLine);
      if (unit) {
        return unit;
      }
    }
  }
  return null;
}

function entryPointLabel(unit: CodeUnitStartedLine): string {
  const text = unit.text;
  if (text === 'execute_anonymous_apex') {
    return 'Anonymous Apex';
  }
  switch (unit.codeUnitType) {
    case 'VF':
      return `VF ${text.slice(text.lastIndexOf('/') + 1)}`;
    case '__sfdc_trigger': {
      // Two shapes: "MyTrigger on Account trigger event BeforeInsert", or the raw
      // "__sfdc_trigger/ns/MyTrigger" path when the log omits the friendly form.
      // Either way the name says enough.
      const name = text.startsWith('__sfdc_trigger/')
        ? text.slice(text.lastIndexOf('/') + 1)
        : text.split(' on ')[0];
      return `Trigger ${name}`;
    }
    default:
      return text;
  }
}

/** Matches an event line's `HH:MM:SS.f (elapsedNs)|` prefix. */
const TIMESTAMPED_LINE = /^\d{2}:\d{2}:\d{2}\.\d+ \(\d+\)\|/;

function parseUserInfo(rawLog: string): { username: string; timezone: string } | null {
  // USER_INFO is the first *timestamped* line; only the untimestamped preamble
  // (version header, `Execute Anonymous:` echoes) precedes it. Walking lines and
  // stopping at the first event keeps the cost at the preamble's size, survives a
  // preamble of any length, and can't match a `USER_INFO` quoted inside the echoes
  // or some later event's payload. A cropped log bails at its first event line.
  let start = 0;
  while (start < rawLog.length) {
    const nl = rawLog.indexOf('\n', start);
    const eol = nl === -1 ? rawLog.length : nl;
    const line = rawLog.slice(start, eol);
    if (TIMESTAMPED_LINE.test(line)) {
      // timestamp|USER_INFO|[EXTERNAL]|userId|username|timezone label|timezone offset
      const parts = line.split('|');
      const username = parts[1] === 'USER_INFO' ? (parts[4]?.trim() ?? '') : '';
      return username ? { username, timezone: parts[5]?.trim() ?? '' } : null;
    }
    start = eol + 1;
  }
  return null;
}

function startTimeItem(log: ApexLog, timezone?: string): LogIdentityItem | null {
  if (log.startTime === null) {
    return null;
  }
  const full = formatWallClockTime(log.startTime);
  const started = `Started ${full}`;
  // A space, not the header's ` • ` separator — the label starts with "(GMT±HH:MM)",
  // and a dot would make the tooltip read as two unrelated items.
  return { label: full.slice(0, 8), detail: timezone ? `${started} ${timezone}` : started };
}
