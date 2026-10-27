/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent, ApexLog } from '@apexdevtools/apex-log-parser';
import { html, type TemplateResult } from 'lit';

import {
  formatSOQLToTemplate,
  formatSOQLToText,
  type FormatOptions,
} from '../../soql/format/formatter.js';
import type { Dialect } from '../../soql/format/tokenize.js';
import { eventLabel, eventName } from '../utils/eventText.js';

/** The query language of an event of `type`, or null for an event that runs no query. */
export function queryDialect(type: string | null | undefined): Dialect | null {
  return type === 'SOQL_EXECUTE_BEGIN' ? 'soql' : type === 'SOSL_EXECUTE_BEGIN' ? 'sosl' : null;
}

const isQuery = (node: ApexEvent): boolean => queryDialect(node.type) !== null;

const queryFormat = (node: ApexEvent): FormatOptions => ({
  mode: 'pretty',
  dialect: queryDialect(node.type) ?? 'soql',
});

// Find and copy read every row, and formatting a query on each read is slow. By event id.
const prettyQueries = new WeakMap<ApexLog, Map<number, string>>();

/** What a Name cell shows for event `eventIndex` of `log`, as text. */
export function nameText(log: ApexLog, eventIndex: number, fallback: string): string {
  return textOf(log, eventIndex, log.event(eventIndex), fallback);
}

function textOf(
  log: ApexLog,
  eventIndex: number,
  node: ApexEvent | null,
  fallback: string,
): string {
  if (!node) {
    return fallback;
  }
  if (isQuery(node)) {
    let byId = prettyQueries.get(log);
    if (!byId) {
      byId = new Map();
      prettyQueries.set(log, byId);
    }
    let text = byId.get(eventIndex);
    if (text === undefined) {
      text = formatSOQLToText(node.text ?? '', queryFormat(node));
      byId.set(eventIndex, text);
    }
    return text;
  }
  return node.isApexCall ? eventName(node) : eventLabel(node);
}

/** What copy and export write for a Name cell: a query as the log has it. */
export function nameExportText(log: ApexLog, eventIndex: number, fallback: string): string {
  const node = log.event(eventIndex);
  return node && isQuery(node) ? (node.text ?? '') : textOf(log, eventIndex, node, fallback);
}

/**
 * A Name cell: a query, highlighted; a link that opens the type in the editor; or the
 * label. A click that ends a text selection does not follow the link.
 */
export function nameCell(
  log: ApexLog,
  eventIndex: number,
  fallback: string,
  openType: (text: string) => void,
): TemplateResult | string {
  const node = log.event(eventIndex);
  if (!node) {
    return fallback;
  }
  if (isQuery(node)) {
    return html`<span class="soql-block"
      >${formatSOQLToTemplate(node.text ?? '', queryFormat(node))}</span
    >`;
  }
  if (node.isApexCall) {
    const text = node.text ?? '';
    return html`<a
      href="#!"
      @click=${(e: MouseEvent) => {
        e.preventDefault();
        if (window.getSelection()?.type !== 'Range') {
          openType(text);
        }
      }}
      >${eventName(node)}</a
    >`;
  }
  return eventLabel(node);
}
