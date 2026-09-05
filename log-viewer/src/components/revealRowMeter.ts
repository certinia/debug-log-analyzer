/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html } from 'lit';

import { formatDuration } from '../core/utility/Util.js';

/** One named part of a row's bar: its share of the log, and what it stands for. */
export interface MeterPart {
  /** Share of the log, in percent, so the parts add up to the bar's own length. */
  share: number;
  title: string;
}

/**
 * The shared magnitude bar with a hover target per part. The track is a hairline
 * and clips its children, so the targets sit over it instead: transparent, tall
 * enough to aim at, and each carrying its own tooltip. A child's `title` wins
 * over the row's, which keeps the whole split for the keyboard. `title` is the
 * row's own, on the band itself: the space past the bar is then a titled element
 * like every part, so the tooltip swaps there instead of restarting its timer.
 */
export function revealRowMeter(total: number, parts: MeterPart[], title: string) {
  return html`<span class="reveal-row__meter-wrap">
    <span class="reveal-row__meter"
      ><span class="reveal-row__meter-fill" style="width: ${total}%"></span
    ></span>
    <span class="reveal-row__meter-hits" aria-hidden="true" title=${title}
      >${parts
        .filter((part) => part.share > 0)
        .map(
          (part) =>
            html`<span
              class="reveal-row__meter-hit"
              style="width: ${part.share}%"
              title=${part.title}
            ></span>`,
        )}</span
    >
  </span>`;
}

/** What a row merges and how its time splits, in absolute times: the reading a
 *  truncated row and the keyboard would otherwise lose. Empty tails drop out. */
export function revealRowTitle(
  row: { count: number; totalTime: number; selfTime: number },
  ...tail: string[]
): string {
  const parts = row.count > 1 ? [`${row.count} calls merged`] : [];
  parts.push(`total ${formatDuration(row.totalTime)}`, `self ${formatDuration(row.selfTime)}`);
  return parts.concat(tail.filter(Boolean)).join(' · ');
}
