/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, CodeUnitStartedLine } from '@apexdevtools/apex-log-parser';
import type { LogTimezone } from '@apexdevtools/apex-log-parser/types';

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

/** Derives the header identity from a parsed log. */
export function deriveLogIdentity(log: ApexLog): LogIdentityData {
  const { entryPoint, userInfo } = log;
  // A header line can state no name at all. Keyed on the name, not the line, so the
  // header drops the chunk rather than showing a separator around an empty item.
  const userName = userInfo?.userName;
  return {
    entryPoint: entryPoint ? { label: entryPointLabel(entryPoint), detail: entryPoint.text } : null,
    user: userName ? { label: userName.split('@')[0] || userName, detail: userName } : null,
    // The timezone sits with the time, not the user: the log's timestamps are
    // rendered in that zone, so it qualifies the clock reading.
    startTime: startTimeItem(log, userInfo ? formatTimezone(userInfo.timezone) : ''),
  };
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

/**
 * Rebuilds the header's `(GMT±HH:MM) Label (IANA/Name)` wording from the parts the parser splits
 * it into. The offset reproduces exactly, but a log stating a bare label gains a prefix it never
 * carried, since nothing in `LogTimezone` says whether one was there. apex-log-parser#85 asks for
 * the source text, which would replace this.
 */
function formatTimezone({ label, name, offsetMinutes }: LogTimezone): string {
  const offset = offsetMinutes === null ? '' : `(GMT${gmtOffset(offsetMinutes)})`;
  return [offset, label, name ? `(${name})` : ''].filter(Boolean).join(' ');
}

function gmtOffset(offsetMinutes: number): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const absolute = Math.abs(offsetMinutes);
  return `${offsetMinutes < 0 ? '-' : '+'}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function startTimeItem(log: ApexLog, timezone: string): LogIdentityItem | null {
  if (log.startTime === null) {
    return null;
  }
  const full = formatWallClockTime(log.startTime);
  const started = `Started ${full}`;
  // A space, not the header's ` • ` separator — the label starts with "(GMT±HH:MM)",
  // and a dot would make the tooltip read as two unrelated items.
  return { label: full.slice(0, 8), detail: timezone ? `${started} ${timezone}` : started };
}
