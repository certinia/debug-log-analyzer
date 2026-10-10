/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent, SelfTotal } from '@apexdevtools/apex-log-parser';

import { bar } from '../../../components/grid/cells.js';
import { COUNT_MIN_WIDTH, countColumn, timeColumn } from '../../../components/grid/columns.js';
import { NO_REPORTED_LIMITS_TEXT } from '../../../components/governorCopy.js';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import { sharePercent } from '../../../core/utility/Util.js';
import {
  max,
  sum,
  type Calc,
  type GridColumn,
  type GridSort,
  type GroupBy,
  type RowFilter,
  type TreeSource,
} from '../../../grid/index.js';
import { NAMESPACE_WIDTH } from '../../../tabulator/ColumnWidths.js';
import { soqlGroupCell } from '../../soql/format/groupHeader.js';
import type { AggregatedRow, BottomUpRow } from '../utils/Aggregation.js';
import {
  costLimitsOf,
  governorCostBreakdown,
  governorCostOf,
  type GovernorCostMetric,
  type GovernorCostRow,
  type GovernorUsage,
} from '../utils/GovernorCost.js';
import { isDetailEvent } from '../utils/TimeOrderTree.js';
import { nameCell, nameExportText, nameText } from './cells.js';
import { knownMax, outermostSum } from './calcs.js';

/** What every call-tree row carries, whichever view built it. */
type MetricRow = GovernorUsage & { namespace: string; thrownCount: SelfTotal };

/** The fields a row either holds, or works out from its event when a cell asks. */
interface RowFields<R> {
  event(row: R): LogEvent;
  text(row: R): string;
  callerNamespace(row: R): string;
  type(row: R): string;
  governorCost(row: R): number | null;
  governorCostMax(row: R): number | null;
}

type HeldRow = GovernorCostRow & {
  originalData: LogEvent;
  text: string;
  callerNamespace: string;
  type: string;
};

function heldFields<R extends HeldRow>(): RowFields<R> {
  return {
    event: (row) => row.originalData,
    text: (row) => row.text,
    callerNamespace: (row) => row.callerNamespace,
    type: (row) => row.type,
    governorCost: (row) => row.governorCost,
    governorCostMax: (row) => row.governorCostMax,
  };
}

function eventFields(log: ApexLog): RowFields<LogEvent> {
  const costLimits = costLimitsOf(log.governorLimits);
  return {
    event: (event) => event,
    text: (event) => event.text,
    callerNamespace: getCallerNamespace,
    type: (event) => event.type ?? '',
    governorCost: (event) => governorCostOf(event, costLimits)[0],
    governorCostMax: (event) => governorCostOf(event, costLimits)[1],
  };
}

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

const ROWS_WIDTH = 63;

// formatInteger's toLocaleString builds a formatter per call: find over 500k rows is seconds.
const integerFormat = new Intl.NumberFormat();
const integer = (value: number): string => integerFormat.format(Math.round(value));

function nameColumn<R>(fields: RowFields<R>, options: CallTreeColumnOptions): GridColumn<R> {
  return {
    id: 'text',
    title: 'Name',
    width: 'flex',
    minWidth: 200,
    cell: (row) => nameCell(fields.event(row), fields.text(row), options.openType),
    text: (row) => nameText(fields.event(row), fields.text(row)),
    exportText: (row) => nameExportText(fields.event(row), fields.text(row)),
    sort: { value: fields.text },
    sortFirst: 'desc',
    footer: 'Total',
  };
}

function namespaceColumns<R extends MetricRow>(fields: RowFields<R>): GridColumn<R>[] {
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
      cell: fields.callerNamespace,
      text: fields.callerNamespace,
      sort: { value: fields.callerNamespace },
      sortFirst: 'desc',
    },
  ];
}

function typeColumn<R>(fields: RowFields<R>, hidden: boolean): GridColumn<R> {
  return {
    id: 'type',
    title: 'Type',
    width: 150,
    hidden,
    cell: fields.type,
    text: fields.type,
    tooltip: fields.type,
    sort: { value: fields.type },
    sortFirst: 'asc',
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
function utilisationColumn<R>(opts: {
  id: 'governorCost' | 'governorCostMax';
  title: string;
  value: (row: R) => number | null;
  width: number;
  hidden?: boolean;
  tooltip: (row: R, value: number) => string;
}): GridColumn<R> {
  const { value } = opts;
  const present = (v: number | null): v is number => v !== null && !Number.isNaN(v);
  const shown = (v: number | null) =>
    present(v) ? bar(v, 100, { precision: 0, percent: false }) : '—';
  return {
    id: opts.id,
    title: opts.title,
    width: opts.width,
    minWidth: opts.width,
    align: 'end',
    hidden: opts.hidden,
    cell: (row) => shown(value(row)),
    text: (row) => {
      const v = value(row);
      return present(v) ? v.toFixed(0) : '—';
    },
    exportText: (row) => {
      const v = value(row);
      return present(v) ? String(v) : '';
    },
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

/** The governor, heap and utilisation block every call-tree table shares, in display order. */
function governorMetricColumns<R extends MetricRow>(
  log: ApexLog,
  fields: RowFields<R>,
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
      value: fields.governorCost,
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
      value: fields.governorCostMax,
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

/** Time Order rows are the parser's own events: nothing is built before the grid shows them. */
export function timeOrderSource(log: ApexLog): TreeSource<LogEvent> {
  return { roots: log.children, children: (event) => event.children, key: (e) => e.eventIndex };
}

function lineBreaks(text: string | null | undefined): number {
  if (!text) {
    return 0;
  }
  let count = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    count++;
  }
  return count;
}

/**
 * The lines a Name shows: its label is the text and suffix, after a 1-line type at most.
 * Read from the event, as no label is built for it. A query is counted as written,
 * though its cell lays it out on more.
 */
function nameLines(event: LogEvent): number {
  return 1 + lineBreaks(event.text) + lineBreaks(event.suffix);
}

/**
 * An Aggregated or Bottom-Up row's lines, for the grid's `rowLines`. Time Order has none: at
 * 580k rows the count cost a long task on each sort, filter and expand, and its rows are
 * nearly all 1 line.
 */
export const mergedLines = (row: { originalData: LogEvent }): number => nameLines(row.originalData);

/** Show Details on the Time Order tree. */
export const TIME_ORDER_DETAILS: RowFilter<LogEvent> = { test: isDetailEvent, keepAncestors: true };

/** Show Details on the Bottom-Up tree. */
export const BOTTOM_UP_DETAILS: RowFilter<BottomUpRow> = { test: (row) => row._hasDetailsDeep };

/** The Bottom-Up row field each group-by picker value groups on; None has none. */
const GROUP_FIELDS: Record<string, 'namespace' | 'callerNamespace' | 'type'> = {
  Namespace: 'namespace',
  'Caller Namespace': 'callerNamespace',
  Type: 'type',
};

/** The Bottom-Up grouping for a group-by picker value, or null for none. */
export function bottomUpGroupBy(value: string): GroupBy<BottomUpRow> | null {
  const field = GROUP_FIELDS[value];
  return field ? (row) => row[field] ?? '' : null;
}

/** The Time Order columns: the Tabulator table's, field for field. */
export function timeOrderColumns(
  log: ApexLog,
  options: CallTreeColumnOptions,
): GridColumn<LogEvent>[] {
  const totalNs = log.duration.total;
  const fields = eventFields(log);
  return [
    nameColumn(fields, options),
    ...namespaceColumns(fields),
    typeColumn(fields, true),
    ...governorMetricColumns(log, fields, {
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
  const fields = heldFields<BottomUpRow>();
  return [
    {
      ...nameColumn(fields, options),
      groupCell: soqlGroupCell,
    },
    ...namespaceColumns(fields),
    typeColumn(fields, false),
    countColumn<BottomUpRow>({
      id: 'callCount',
      title: 'Calls',
      value: (r) => r.callCount,
      width: 70,
    }),
    // Bottom-up rows overlap, so totals count each call once; self never overlaps.
    ...governorMetricColumns(log, fields, {
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

/** The Aggregated columns: the Tabulator table's, field for field. */
export function aggregatedColumns(
  log: ApexLog,
  options: CallTreeColumnOptions,
): GridColumn<AggregatedRow>[] {
  const totalNs = log.duration.total;
  const fields = heldFields<AggregatedRow>();
  return [
    nameColumn(fields, options),
    ...namespaceColumns(fields),
    typeColumn(fields, true),
    countColumn<AggregatedRow>({
      id: 'callCount',
      title: 'Calls',
      value: (r) => r.callCount,
      width: 70,
    }),
    // A callee row sits inside its caller's total; self never overlaps.
    ...governorMetricColumns(log, fields, {
      netTotal: sum((r) => r.heapAllocated.total),
      grossTotal: sum((r) => r.heapGross.total),
      netSelf: sum((r) => r.heapAllocated.self, 'all'),
      grossSelf: sum((r) => r.heapGross.self, 'all'),
    }),
    timeColumn<AggregatedRow>({
      id: 'totalTime',
      title: 'Total Time (ms)',
      value: (r) => r.totalTime,
      totalNs,
      calc: sum((r) => r.totalTime),
    }),
    timeColumn<AggregatedRow>({
      id: 'totalSelfTime',
      title: 'Self Time (ms)',
      value: (r) => r.totalSelfTime,
      totalNs,
      calc: sum((r) => r.totalSelfTime, 'all'),
    }),
    timeColumn<AggregatedRow>({
      id: 'avgSelfTime',
      title: 'Avg Self Time (ms)',
      value: (r) => r.avgSelfTime,
      totalNs,
      hidden: true,
    }),
  ];
}
