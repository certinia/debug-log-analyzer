/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, CodeUnitStartedLine } from '@apexdevtools/apex-log-parser';

import { formatDuration, formatWallClockTime } from '../../core/utility/Util.js';

/**
 * One header identity item: `label` is the compact display text, `detail` the tooltip, and
 * `count` how many more items the label stands in front of.
 */
export interface LogIdentityItem {
  label: string;
  detail: string;
  count?: number;
}

/** The transaction identity shown in the header: what ran, who ran it, and when. */
export interface LogIdentityData {
  entryPoint: LogIdentityItem | null;
  user: LogIdentityItem | null;
  startTime: LogIdentityItem | null;
}

/** Derives the header identity from a parsed log. */
export function deriveLogIdentity(log: ApexLog): LogIdentityData {
  const { entryPoints, userInfo } = log;
  // A header line can state no name at all. Keyed on the name, not the line, so the
  // header drops the chunk rather than showing a separator around an empty item.
  const userName = userInfo?.userName;
  return {
    entryPoint: entryPointItem(entryPoints),
    user: userName ? { label: userName.split('@')[0] || userName, detail: userName } : null,
    // The timezone sits with the time, not the user: the log's timestamps are
    // rendered in that zone, so it qualifies the clock reading.
    startTime: startTimeItem(log, userInfo?.timezone?.text ?? ''),
  };
}

const MAX_LISTED_ENTRY_POINTS = 5;

function entryPointItem(units: CodeUnitStartedLine[]): LogIdentityItem | null {
  // Not log order: the first can be a short platform step, e.g. `FutureHandler - state load`.
  const ranked = units.toSorted((a, b) => b.duration.total - a.duration.total);
  const [longest] = ranked;
  if (!longest) {
    return null;
  }
  const label = entryPointLabel(longest);
  if (ranked.length === 1) {
    return { label, detail: longest.text };
  }
  const shown = ranked
    .slice(0, MAX_LISTED_ENTRY_POINTS)
    .map((unit) => `${entryPointLabel(unit)} (${formatDuration(unit.duration.total)})`);
  const hidden = ranked.length - shown.length;
  if (hidden) {
    shown.push(`+${hidden} more`);
  }
  return {
    label,
    detail: `${ranked.length} entry points, longest first: ${shown.join(' · ')}`,
    count: ranked.length - 1,
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

function startTimeItem(log: ApexLog, timezone: string): LogIdentityItem | null {
  if (log.startTime === null) {
    return null;
  }
  const full = formatWallClockTime(log.startTime);
  const started = `Started ${full}`;
  // A space, not ` • `: the timezone qualifies the time, not a separate header item.
  return { label: full.slice(0, 8), detail: timezone ? `${started} ${timezone}` : started };
}
