/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { formatNsAsMs } from '#core/utility/Duration.js';
import { formatDuration } from '#core/utility/Util.js';
import { formatSOQL, formatSOQLToText } from '../../features/soql/format/formatter.js';
import type { Dialect } from '../../features/soql/format/tokenize.js';
import { sum, type Calc, type GridColumn } from '../../grid/index.js';
import { msBar } from './cells.js';

/** A right-aligned number, empty where the row has none, with a summed footer unless `summed` is false. */
export function countColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => number | null | undefined;
  hidden?: boolean;
  summed?: boolean;
  /** The footer in place of a sum of `value`. */
  calc?: Calc<R>;
}): GridColumn<R> {
  const text = (row: R) => String(opts.value(row) ?? '');
  return {
    id: opts.id,
    title: opts.title,
    width: 'content',
    align: 'end',
    hidden: opts.hidden,
    cell: text,
    text,
    sort: { value: opts.value },
    sortFirst: 'desc',
    calc: opts.summed === false ? undefined : (opts.calc ?? sum((row) => opts.value(row) ?? 0)),
  };
}

/** A time in nanoseconds, as milliseconds with a bar for its share of `totalNs`, read at each paint. */
export function timeColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => number;
  totalNs: number | (() => number);
  calc?: Calc<R>;
  hidden?: boolean;
  /** Pixels. Default `content`. */
  width?: number;
}): GridColumn<R> {
  const { totalNs } = opts;
  const total = typeof totalNs === 'number' ? () => totalNs : totalNs;
  return {
    id: opts.id,
    title: opts.title,
    width: opts.width ?? 'content',
    align: 'end',
    hidden: opts.hidden,
    cell: (row) => msBar(opts.value(row), total()),
    text: (row) => formatNsAsMs(opts.value(row)),
    tooltip: (row) => formatDuration(opts.value(row)),
    sort: { value: opts.value },
    sortFirst: 'desc',
    calc: opts.calc,
    total: (value) => msBar(value, total()),
  };
}

/** A plain text column, empty where the row has no value; `hoverText` shows it on hover. */
export function textColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => string | null | undefined;
  hidden?: boolean;
  hoverText?: boolean;
  empty?: string;
}): GridColumn<R> {
  const text = (row: R) => opts.value(row) ?? '';
  return {
    id: opts.id,
    title: opts.title,
    width: 'content',
    hidden: opts.hidden,
    cell: (row) => opts.value(row) ?? opts.empty ?? '',
    text,
    tooltip: opts.hoverText ? text : undefined,
    sort: { value: opts.value },
    sortFirst: 'desc',
  };
}

/**
 * Text that shows a query inline and highlighted where `dialect` names one, with a
 * "Total" footer. Find searches what it shows; copy and CSV write the raw text.
 */
export function inlineQueryColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => string;
  dialect: (row: R) => Dialect | null;
}): GridColumn<R> {
  const { dialect, value } = opts;
  // Keyed by query, not row: a log repeats a few queries many times, and find, copy and paint all format.
  const inlineHtml = new Map<string, string>();
  const inlineText = new Map<string, string>();
  return {
    id: opts.id,
    title: opts.title,
    minWidth: 140,
    cell: (row) => {
      const query = dialect(row);
      return query
        ? html`<span class="soql-block soql-inline"
            >${unsafeHTML(
              cached(inlineHtml, `${query}:${value(row)}`, () =>
                formatSOQL(value(row), { mode: 'inline', dialect: query }),
              ),
            )}</span
          >`
        : value(row);
    },
    text: (row) => {
      const query = dialect(row);
      return query
        ? cached(inlineText, `${query}:${value(row)}`, () =>
            formatSOQLToText(value(row), { mode: 'inline', dialect: query }),
          )
        : value(row);
    },
    exportText: value,
    tooltip: value,
    sort: { value },
    footer: 'Total',
  };
}

function cached<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let value = cache.get(key);
  if (value === undefined) {
    value = make();
    cache.set(key, value);
  }
  return value;
}
