/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, nothing, type TemplateResult } from 'lit';

import { nsToMs } from '../../core/utility/Duration.js';
import { sharePercent } from '../../core/utility/Util.js';
import { MIN_VISIBLE_PERCENT } from '../../tabulator/format/ProgressComponent.js';

export interface BarOptions {
  precision?: number;
  /** Show the share of `total` after the value. Default true. */
  percent?: boolean;
}

/** A value with a bar for its share of `total`: the template twin of `progressComponent`. */
export function bar(value: number, total: number, options: BarOptions = {}): TemplateResult {
  const { precision = 2, percent = true } = options;
  const share = sharePercent(value, total);
  // `data-grid-find-text` is the grid's FIND_TEXT_ATTR: find marks the value, not the percent.
  return html`<div class="progress-wrapper">
    ${
      value > 0 && total > 0
        ? html`<div
            class="progress-bar"
            style="width: ${Math.max(share, MIN_VISIBLE_PERCENT)}%"
          ></div>`
        : nothing
    }
    <div class="progress-bar__text">
      <span data-grid-find-text>${(value || 0).toFixed(precision)}</span>${
        percent
          ? html`<span class="progress-bar__text__percent"
              >(${Math.round(share).toFixed(2)}%)</span
            >`
          : nothing
      }
    </div>
  </div>`;
}

/** Nanoseconds as milliseconds, with a bar for their share of `totalNs`. */
export const msBar = (ns: number, totalNs: number): TemplateResult =>
  bar(nsToMs(ns), nsToMs(totalNs));

/** The text of a time cell, which find searches and copy writes. */
export const msText = (ns: number): string => nsToMs(ns).toFixed(2);
