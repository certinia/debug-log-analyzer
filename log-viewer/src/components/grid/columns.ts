/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { formatDuration } from '../../core/utility/Util.js';
import { sum, type Calc, type GridColumn } from '../../grid/index.js';
import { TIME_WIDTH } from '../../tabulator/ColumnWidths.js';
import { msBar, msText } from './cells.js';

export const COUNT_MIN_WIDTH = 60;
const TIME_MIN_WIDTH = 120;

/** A right-aligned integer with a summed footer, for a count with no limit to draw against. */
export function countColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => number;
  width: number;
  hidden?: boolean;
}): GridColumn<R> {
  return {
    id: opts.id,
    title: opts.title,
    width: opts.width,
    minWidth: COUNT_MIN_WIDTH,
    align: 'end',
    hidden: opts.hidden,
    cell: (row) => String(opts.value(row)),
    text: (row) => String(opts.value(row)),
    sort: { value: opts.value },
    sortFirst: 'desc',
    calc: sum(opts.value),
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
