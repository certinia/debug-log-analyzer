/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent, SelfTotal } from '@apexdevtools/apex-log-parser';
import { html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { NO_REPORTED_LIMITS_TEXT } from '../../../components/governorCopy.js';
import { formatDuration, formatInteger, sharePercent } from '../../../core/utility/Util.js';
import { max, sum, type Calc, type GridColumn, type GridSort } from '../../../grid/index.js';
import { NAMESPACE_WIDTH, TIME_WIDTH } from '../../../tabulator/ColumnWidths.js';
import { soqlGroupHeader } from '../../soql/format/groupHeader.js';
import type { BottomUpRow } from '../utils/Aggregation.js';
import {
  governorCostBreakdown,
  type GovernorCostMetric,
  type GovernorCostRow,
} from '../utils/GovernorCost.js';
import type { TimeOrderRow } from '../utils/TimeOrderTree.js';
import { bar, msBar, msText, nameCell, nameText } from './cells.js';
import { knownMax, outermostSum } from './calcs.js';

/** What every call-tree row carries, whichever view built it. */
type MetricRow = GovernorCostRow &
  Pick<
    TimeOrderRow,
    | 'text'
    | 'originalData'
    | 'namespace'
    | 'callerNamespace'
    | 'type'
    | 'dmlCount'
    | 'soqlCount'
    | 'soslCount'
    | 'dmlRowCount'
    | 'soqlRowCount'
    | 'soslRowCount'
    | 'thrownCount'
    | 'heapAllocated'
    | 'heapGross'
    | 'heapPeak'
    | 'governorCost'
    | 'governorCostMax'
  >;

export interface CallTreeColumnOptions {
  /** Opens a type in the editor, from a Name cell link. */
  openType: (text: string) => void;
}

/** Footer and group totals of the heap columns: each table counts them its own way. */
export interface HeapCalcs<R> {
  netTotal: Calc<R>;
  netSelf: Calc<R>;
  grossTotal: Calc<R>;
  grossSelf: Calc<R>;
}

/** Bottom-Up opens sorted by self time, largest first. */
export const BOTTOM_UP_SORT: GridSort = { column: 'totalSelfTime', dir: 'desc' };

const COUNT_MIN_WIDTH = 60;
const ROWS_WIDTH = 63;
const TIME_MIN_WIDTH = 120;

const integer = (value: number): string => formatInteger(value);

function nameColumn<R extends MetricRow>(options: CallTreeColumnOptions): GridColumn<R> {
  return {
    id: 'text',
    title: 'Name',
    width: 'flex',
    minWidth: 200,
    cell: (row) => nameCell(row.originalData, row.text, options.openType),
    text: (row) => nameText(row.originalData, row.text),
    sort: { value: (row) => row.text },
    sortFirst: 'desc',
    footer: 'Total',
  };
}

function namespaceColumns<R extends MetricRow>(): GridColumn<R>[] {
  return [
    {
      id: 'namespace',
      title: 'Namespace',
      width: NAMESPACE_WIDTH,
      minWidth: 80,
      cell: (row) => row.namespace,
      text: (row) => row.namespace,
      sort: { value: (row) => row.namespace },
      sortFirst: 'desc',
    },
    {
      id: 'callerNamespace',
      title: 'Caller Namespace',
      width: NAMESPACE_WIDTH,
      hidden: true,
      cell: (row) => row.callerNamespace,
      text: (row) => row.callerNamespace,
      sort: { value: (row) => row.callerNamespace },
      sortFirst: 'desc',
    },
  ];
}

function typeColumn<R extends MetricRow>(hidden: boolean): GridColumn<R> {
  return {
    id: 'type',
    title: 'Type',
    width: 150,
    hidden,
    cell: (row) => row.type,
    text: (row) => row.type,
    tooltip: (row) => row.type,
    sort: { value: (row) => row.type },
    sortFirst: 'asc',
  };
}

/** A right-aligned integer with a summed footer, for a count with no limit to draw against. */
function countColumn<R>(opts: {
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

/**
 * A governor metric as a bar against what the whole log spent of it, with the limit in
 * the tooltip. See `createGovernorColumn` for why the bar is not against the limit.
 */
function governorColumn<R extends MetricRow>(opts: {
  id: string;
  title: string;
  metric: (row: R) => SelfTotal;
  part: 'total' | 'self';
  total: number;
  limit: number;
  width?: number;
}): GridColumn<R> {
  const { total, limit } = opts;
  const value = (row: R): number => opts.metric(row)[opts.part];
  const shown = (v: number) => bar(v, total, { precision: 0, percent: false });
  return {
    id: opts.id,
    title: opts.title,
    width: opts.width ?? 70,
    minWidth: COUNT_MIN_WIDTH,
    align: 'end',
    hidden: opts.part === 'self',
    cell: (row) => shown(value(row)),
    text: (row) => String(value(row)),
    tooltip: (row) => {
      const v = value(row);
      const share =
        total > 0
          ? `${integer(v)} of ${integer(total)} (${sharePercent(v, total).toFixed(1)}% of log)`
          : integer(v);
      return limit > 0
        ? `${share} · ${sharePercent(v, limit).toFixed(1)}% of the ${integer(limit)} limit`
        : share;
    },
    sort: { value },
    sortFirst: 'desc',
    calc: sum(value),
    total: shown,
  };
}

function usedOfLimit({ unit, used, limit }: GovernorCostMetric): string {
  const figure = (value: number): string => (unit === 'byte' ? integer(value) : `${value}`);
  return `${figure(used)}/${figure(limit)}`;
}

/** A utilisation percentage as a bar, or `—` where the log reported no limits to measure. */
function utilisationColumn<R extends MetricRow>(opts: {
  id: 'governorCost' | 'governorCostMax';
  title: string;
  width: number;
  hidden?: boolean;
  tooltip: (row: R, value: number) => string;
}): GridColumn<R> {
  const value = (row: R): number | null => row[opts.id];
  const shown = (v: number | null) =>
    v === null || Number.isNaN(v) ? '—' : bar(v, 100, { precision: 0, percent: false });
  return {
    id: opts.id,
    title: opts.title,
    width: opts.width,
    minWidth: opts.width,
    align: 'end',
    hidden: opts.hidden,
    cell: (row) => shown(value(row)),
    text: (row) => String(value(row) ?? '—'),
    tooltip: (row) => {
      const v = value(row);
      return v === null ? NO_REPORTED_LIMITS_TEXT : opts.tooltip(row, v);
    },
    sort: { value },
    sortFirst: 'desc',
    calc: knownMax(value),
    total: shown,
  };
}

/** A heap figure in bytes, as a thousand-separated integer. */
function heapColumn<R extends MetricRow>(opts: {
  id: string;
  title: string;
  description: string;
  value: (row: R) => number;
  calc: Calc<R>;
  width: number;
  hidden?: boolean;
}): GridColumn<R> {
  const text = (row: R): string => integer(opts.value(row));
  return {
    id: opts.id,
    title: opts.title,
    description: opts.description,
    width: opts.width,
    minWidth: 70,
    align: 'end',
    hidden: opts.hidden,
    cell: text,
    text,
    tooltip: text,
    sort: { value: opts.value },
    sortFirst: 'desc',
    calc: opts.calc,
    total: integer,
  };
}

/** A time in nanoseconds, as milliseconds with a bar for its share of the whole log. */
function timeColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => number;
  totalNs: number;
  calc?: Calc<R>;
  hidden?: boolean;
}): GridColumn<R> {
  return {
    id: opts.id,
    title: opts.title,
    width: TIME_WIDTH,
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

/** The governor, heap and utilisation block every call-tree table shares, in display order. */
function governorMetricColumns<R extends MetricRow>(
  log: ApexLog,
  heap: HeapCalcs<R>,
): GridColumn<R>[] {
  const limits = log.governorLimits.final;
  const metric = (
    id: string,
    title: string,
    of: (row: R) => SelfTotal,
    total: number,
    limit: number,
    width?: number,
  ): GridColumn<R>[] => [
    governorColumn({ id: `${id}.total`, title, metric: of, part: 'total', total, limit, width }),
    governorColumn({
      id: `${id}.self`,
      title: `${title} self`,
      metric: of,
      part: 'self',
      total,
      limit,
      width,
    }),
  ];
  return [
    ...metric(
      'dmlCount',
      'DML Count',
      (r) => r.dmlCount,
      log.dmlCount.total,
      limits.dmlStatements.limit,
    ),
    ...metric(
      'soqlCount',
      'SOQL Count',
      (r) => r.soqlCount,
      log.soqlCount.total,
      limits.soqlQueries.limit,
    ),
    ...metric(
      'soslCount',
      'SOSL Count',
      (r) => r.soslCount,
      log.soslCount.total,
      limits.soslQueries.limit,
    ),
    // 77 is the narrowest width that doesn't clip "Throws"; 60 did.
    countColumn({
      id: 'thrownCount.total',
      title: 'Throws Count',
      value: (r) => r.thrownCount.total,
      width: 77,
    }),
    ...metric(
      'dmlRowCount',
      'DML Rows',
      (r) => r.dmlRowCount,
      log.dmlRowCount.total,
      limits.dmlRows.limit,
      ROWS_WIDTH,
    ),
    ...metric(
      'soqlRowCount',
      'SOQL Rows',
      (r) => r.soqlRowCount,
      log.soqlRowCount.total,
      limits.queryRows.limit,
      ROWS_WIDTH,
    ),
    // SOSL rows have no governor limit, so they are plain counts rather than bars.
    countColumn({
      id: 'soslRowCount.total',
      title: 'SOSL Rows',
      value: (r) => r.soslRowCount.total,
      width: ROWS_WIDTH,
    }),
    countColumn({
      id: 'soslRowCount.self',
      title: 'SOSL Rows self',
      value: (r) => r.soslRowCount.self,
      width: ROWS_WIDTH,
      hidden: true,
    }),
    heapColumn({
      id: 'heapAllocated.total',
      title: 'Heap Net (bytes)',
      description: 'Net bytes retained on this path (alloc − free); may be negative',
      value: (r) => r.heapAllocated.total,
      calc: heap.netTotal,
      width: 92,
    }),
    heapColumn({
      id: 'heapAllocated.self',
      title: 'Heap Net self (bytes)',
      description:
        'Net bytes retained directly by this node (excluding sub-methods); may be negative',
      value: (r) => r.heapAllocated.self,
      calc: heap.netSelf,
      width: 121,
      hidden: true,
    }),
    heapColumn({
      id: 'heapPeak',
      title: 'Heap Peak (bytes)',
      description: 'Peak live heap on this path (matches the "Maximum heap size" governor)',
      value: (r) => r.heapPeak,
      calc: max((r) => r.heapPeak),
      width: 100,
    }),
    heapColumn({
      id: 'heapGross.total',
      title: 'Heap Alloc (bytes)',
      description: 'Total bytes allocated on this path (ignores frees; churn)',
      value: (r) => r.heapGross.total,
      calc: heap.grossTotal,
      width: 107,
      hidden: true,
    }),
    heapColumn({
      id: 'heapGross.self',
      title: 'Heap Alloc self (bytes)',
      description: 'Bytes allocated directly by this node (excluding sub-methods; ignores frees)',
      value: (r) => r.heapGross.self,
      calc: heap.grossSelf,
      width: 121,
      hidden: true,
    }),
    utilisationColumn({
      id: 'governorCost',
      title: 'Gov Avg %',
      width: 71,
      tooltip: (row, value) => {
        const breakdown = governorCostBreakdown(row, log.governorLimits);
        if (!breakdown.length) {
          return `${value.toFixed(1)}%`;
        }
        const lines = breakdown.map(
          (m) => `${m.label} ${usedOfLimit(m)} (${m.percent.toFixed(1)}%)`,
        );
        return [`${value.toFixed(1)}% — average utilisation across all governors`, ...lines].join(
          '\n',
        );
      },
    }),
    utilisationColumn({
      id: 'governorCostMax',
      title: 'Gov Peak %',
      width: 78,
      hidden: true,
      tooltip: (row, value) => {
        const [top] = governorCostBreakdown(row, log.governorLimits);
        return top
          ? `Tightest single governor: ${top.label} ${usedOfLimit(top)} (${value.toFixed(1)}%)`
          : `${value.toFixed(1)}%`;
      },
    }),
  ];
}

/** The Time Order columns: the Tabulator table's, field for field. */
export function timeOrderColumns(
  log: ApexLog,
  options: CallTreeColumnOptions,
): GridColumn<TimeOrderRow>[] {
  const totalNs = log.duration.total;
  return [
    nameColumn(options),
    ...namespaceColumns(),
    typeColumn(true),
    ...governorMetricColumns<TimeOrderRow>(log, {
      netTotal: sum((r) => r.heapAllocated.total),
      grossTotal: sum((r) => r.heapGross.total),
      // Self never overlaps, so every row that passes the filters counts, open or not.
      netSelf: sum((r) => r.heapAllocated.self, 'all'),
      grossSelf: sum((r) => r.heapGross.self, 'all'),
    }),
    // Time columns sit at the far right of every call-tree table.
    timeColumn({
      id: 'duration.total',
      title: 'Total Time (ms)',
      value: (r) => r.duration.total,
      totalNs,
      calc: sum((r) => r.duration.total),
    }),
    timeColumn({
      id: 'duration.self',
      title: 'Self Time (ms)',
      value: (r) => r.duration.self,
      totalNs,
      calc: sum((r) => r.duration.self, 'all'),
    }),
  ];
}

const eventsTotal = (event: LogEvent): number => event.duration.total;

/** The Bottom-Up columns: the Tabulator table's, field for field. */
export function bottomUpColumns(
  log: ApexLog,
  options: CallTreeColumnOptions,
): GridColumn<BottomUpRow>[] {
  const totalNs = log.duration.total;
  return [
    {
      ...nameColumn<BottomUpRow>(options),
      groupCell: (group) => {
        const query = soqlGroupHeader(group.key, group.rows.length, group.rows);
        return query ? html`${unsafeHTML(query)}` : `${group.key} (${group.rows.length})`;
      },
    },
    ...namespaceColumns<BottomUpRow>(),
    typeColumn<BottomUpRow>(false),
    countColumn<BottomUpRow>({
      id: 'callCount',
      title: 'Calls',
      value: (r) => r.callCount,
      width: 70,
    }),
    // Bottom-up rows overlap, so totals count each call once; self never overlaps.
    ...governorMetricColumns<BottomUpRow>(log, {
      netTotal: outermostSum((e) => e.heapAllocated.total),
      grossTotal: outermostSum((e) => e.heapGross.total),
      netSelf: sum((r) => r.heapAllocated.self),
      grossSelf: sum((r) => r.heapGross.self),
    }),
    timeColumn<BottomUpRow>({
      id: 'totalTime',
      title: 'Total Time (ms)',
      value: (r) => r.totalTime,
      totalNs,
      calc: outermostSum(eventsTotal),
    }),
    timeColumn<BottomUpRow>({
      id: 'totalSelfTime',
      title: 'Self Time (ms)',
      value: (r) => r.totalSelfTime,
      totalNs,
      calc: sum((r) => r.totalSelfTime),
    }),
    timeColumn<BottomUpRow>({
      id: 'avgSelfTime',
      title: 'Avg Self Time (ms)',
      value: (r) => r.avgSelfTime,
      totalNs,
      hidden: true,
    }),
  ];
}
