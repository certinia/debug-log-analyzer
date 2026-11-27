/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, nothing, type TemplateResult } from 'lit';

import { nsToMs } from '#core/utility/Duration.js';
import { sharePercent } from '#core/utility/Util.js';

// A real share that rounds to 0% still shows, as a hairline.
const MIN_VISIBLE_PERCENT = 1;

export interface BarOptions {
  precision?: number;
  /** Show the share of `total` after the value. Default true. */
  percent?: boolean;
}

/** A value with a bar for its share of `total`. */
export function bar(value: number, total: number, options: BarOptions = {}): TemplateResult {
  const { precision = 2, percent = true } = options;
  const share = sharePercent(value, total);
  const barWidth = value > 0 && total > 0 ? Math.max(share, MIN_VISIBLE_PERCENT) : 0;
  // `data-grid-find-text` is the grid's FIND_TEXT_ATTR: find marks the value, not the percent.
  return html`<div class="progress-wrapper" style="background-size: ${barWidth}% 100%"
    ><span data-grid-find-text>${(value || 0).toFixed(precision)}</span>${
      percent
        ? html`<span class="progress-bar__text__percent">(${Math.round(share).toFixed(2)}%)</span>`
        : nothing
    }</div
  >`;
}

/** Nanoseconds as milliseconds, with a bar for their share of `totalNs`. */
export const msBar = (ns: number, totalNs: number): TemplateResult =>
  bar(nsToMs(ns), nsToMs(totalNs));
