/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { formatDuration } from '../../core/utility/Util.js';
import { sum, type Calc, type GridColumn } from '../../grid/index.js';
import { TIME_WIDTH } from '../../tabulator/ColumnWidths.js';
import { msBar, msText } from './cells.js';

export const COUNT_MIN_WIDTH = 60;
const TIME_MIN_WIDTH = 120;

/** A right-aligned number, empty where the row has none, with a summed footer unless `summed` is false. */
export function countColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => number | null | undefined;
  width: number;
  hidden?: boolean;
  summed?: boolean;
}): GridColumn<R> {
  const text = (row: R) => String(opts.value(row) ?? '');
  return {
    id: opts.id,
    title: opts.title,
    width: opts.width,
    minWidth: COUNT_MIN_WIDTH,
    align: 'end',
    hidden: opts.hidden,
    cell: text,
    text,
    sort: { value: opts.value },
    sortFirst: 'desc',
    calc: opts.summed === false ? undefined : sum((row) => opts.value(row) ?? 0),
  };
}

/** A time in nanoseconds, as milliseconds with a bar for its share of `totalNs`. */
export function timeColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => number;
  totalNs: number;
  calc?: Calc<R>;
  hidden?: boolean;
  width?: number;
}): GridColumn<R> {
  return {
    id: opts.id,
    title: opts.title,
    width: opts.width ?? TIME_WIDTH,
    minWidth: TIME_MIN_WIDTH,
    align: 'end',
    hidden: opts.hidden,
    cell: (row) => msBar(opts.value(row), opts.totalNs),
    text: (row) => msText(opts.value(row)),
    tooltip: (row) => formatDuration(opts.value(row)),
    sort: { value: opts.value },
    sortFirst: 'desc',
    calc: opts.calc,
    total: (value) => msBar(value, opts.totalNs),
  };
}

/** A plain text column, empty where the row has no value; `hoverText` shows it on hover. */
export function textColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => string | null | undefined;
  width: number;
  hidden?: boolean;
  hoverText?: boolean;
  empty?: string;
}): GridColumn<R> {
  const text = (row: R) => opts.value(row) ?? '';
  return {
    id: opts.id,
    title: opts.title,
    width: opts.width,
    hidden: opts.hidden,
    cell: (row) => opts.value(row) ?? opts.empty ?? '',
    text,
    tooltip: opts.hoverText ? text : undefined,
    sort: { value: opts.value },
    sortFirst: 'desc',
  };
}
