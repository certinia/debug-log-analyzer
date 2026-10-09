/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';
import { html, nothing, type TemplateResult } from 'lit';

import { nsToMs } from '../../../core/utility/Duration.js';
import { sharePercent } from '../../../core/utility/Util.js';
import {
  formatSOQLToTemplate,
  formatSOQLToText,
  type FormatOptions,
} from '../../soql/format/formatter.js';
import { MIN_VISIBLE_PERCENT } from '../../../tabulator/format/ProgressComponent.js';
import { eventLabel, eventName } from '../utils/eventText.js';

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

const isQuery = (node: LogEvent): boolean =>
  node.type === 'SOQL_EXECUTE_BEGIN' || node.type === 'SOSL_EXECUTE_BEGIN';

const queryFormat = (node: LogEvent): FormatOptions => ({
  mode: 'pretty',
  dialect: node.type === 'SOSL_EXECUTE_BEGIN' ? 'sosl' : 'soql',
});

// Find and copy read every row, and formatting a query on each read is slow.
const prettyQueries = new WeakMap<LogEvent, string>();

/** What a Name cell shows, as text. */
export function nameText(node: LogEvent | undefined, fallback: string): string {
  if (!node) {
    return fallback;
  }
  if (isQuery(node)) {
    let text = prettyQueries.get(node);
    if (text === undefined) {
      text = formatSOQLToText(node.text, queryFormat(node));
      prettyQueries.set(node, text);
    }
    return text;
  }
  return node.hasValidSymbols ? eventName(node) : eventLabel(node);
}

/** What copy and export write for a Name cell: a query as the log has it. */
export function nameExportText(node: LogEvent | undefined, fallback: string): string {
  return node && isQuery(node) ? node.text : nameText(node, fallback);
}

/**
 * A Name cell: a query, highlighted; a link that opens the type in the editor; or the
 * label. A click that ends a text selection does not follow the link.
 */
export function nameCell(
  node: LogEvent | undefined,
  fallback: string,
  openType: (text: string) => void,
): TemplateResult | string {
  if (!node) {
    return fallback;
  }
  if (isQuery(node)) {
    return html`<span class="soql-block"
      >${formatSOQLToTemplate(node.text, queryFormat(node))}</span
    >`;
  }
  if (node.hasValidSymbols) {
    return html`<a
      href="#!"
      @click=${(e: MouseEvent) => {
        e.preventDefault();
        if (window.getSelection()?.type !== 'Range') {
          openType(node.text);
        }
      }}
      >${eventName(node)}</a
    >`;
  }
  return eventLabel(node);
}
