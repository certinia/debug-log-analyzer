/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent, ApexLog, SelfTotal } from '@apexdevtools/apex-log-parser';
import { html } from 'lit';

import type { ColumnSettingsOptions } from '../../../components/ColumnSettingsController.js';
import { bar } from '../../../components/grid/cells.js';
import { countColumn, timeColumn } from '../../../components/grid/columns.js';
import { NO_REPORTED_LIMITS_TEXT } from '../../../components/governorCopy.js';
import { NO_ROW } from '../../../core/log/LogIndex.js';
import { rowMetrics, type SelfTotalColumns } from '../../../core/log/rowMetrics.js';
import { signaturesOf } from '../../../core/log/signatures.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { DEFAULT_NAMESPACE } from '../../../core/utility/CallerNamespace.js';
import { formatInteger, sharePercent } from '../../../core/utility/Util.js';
import {
  max,
  sum,
  type Calc,
  type GridColumn,
  type GridSort,
  type GroupBy,
  type RowFilter,
} from '../../../grid/index.js';
import { CALL_TREE_VIEWS, type SeenReportedPair } from '../../../components/grid/ColumnViews.js';
import { soqlGroupCell } from '../../soql/format/groupHeader.js';
import type { AggregatedRow, BottomUpRow, Tally } from '../utils/Aggregation.js';
import {
  costLimitsOf,
  governorCostBreakdown,
  governorCostOf,
  type GovernorCostMetric,
  type GovernorCostRow,
  type GovernorUsage,
} from '../utils/GovernorCost.js';
import {
  WHOLE_LOG,
  type ReportedCounts,
  type ReportedMetric,
  type ReportedUsage,
  type TimeSpan,
} from '../utils/reportedUsage.js';
import type { TimeOrderNode, TimeOrderSource } from '../utils/TimeOrderTree.js';
import { nameCell, nameExportText, nameText } from './cells.js';
import { knownMax, outermostSum } from './calcs.js';

type MetricRow = GovernorUsage & { thrownCount: SelfTotal };

interface RowFields<R> {
  /** The id of the event the row names. */
  eventIndex(row: R): number;
  text(row: R): string;
  namespace(row: R): string;
  callerNamespace(row: R): string;
  type(row: R): string;
  /** Read it at once: a Time Order row's is one object, filled again for the next row. */
  usage(row: R): MetricRow;
  governorCost(row: R): number | null;
  governorCostMax(row: R): number | null;
  reported(row: R, metric: ReportedMetric): number;
}

type HeldRow = GovernorCostRow & {
  reported: ReportedCounts;
  eventIndex: number;
  text: string;
  namespace: string;
  callerNamespace: string;
  type: string;
  thrownCount: SelfTotal;
};

function heldFields<R extends HeldRow>(): RowFields<R> {
  return {
    eventIndex: (row) => row.eventIndex,
    text: (row) => row.text,
    namespace: (row) => row.namespace,
    callerNamespace: (row) => row.callerNamespace,
    type: (row) => row.type,
    usage: (row) => row,
    governorCost: (row) => row.governorCost,
    governorCostMax: (row) => row.governorCostMax,
    reported: (row, metric) => row.reported[metric],
  };
}

const tally = (): Tally => ({ self: 0, total: 0 });

function timeOrderFields(
  source: TimeOrderSource,
  usage: ReportedUsage | null,
): RowFields<TimeOrderNode> {
  const { index } = source;
  const { log, eventIndex, parent, start, end } = index;
  const signatures = signaturesOf(log);
  const m = rowMetrics(index);
  const costLimits = costLimitsOf(log.limits);
  // One object for every row: a sort of the whole log reads it per row and keeps nothing.
  const held = {
    dmlCount: tally(),
    soqlCount: tally(),
    soslCount: tally(),
    dmlRowCount: tally(),
    soqlRowCount: tally(),
    soslRowCount: tally(),
    thrownCount: tally(),
    heapAllocated: tally(),
    heapGross: tally(),
    heapPeak: 0,
  };
  const fill = (into: Tally, from: SelfTotalColumns<Int32Array | Float64Array>, row: number) => {
    into.self = from.self[row]!;
    into.total = from.total[row]!;
  };
  const usageOf = ({ row }: TimeOrderNode): MetricRow => {
    fill(held.dmlCount, m.dmlCount, row);
    fill(held.soqlCount, m.soqlCount, row);
    fill(held.soslCount, m.soslCount, row);
    fill(held.dmlRowCount, m.dmlRowCount, row);
    fill(held.soqlRowCount, m.soqlRowCount, row);
    fill(held.soslRowCount, m.soslRowCount, row);
    fill(held.thrownCount, m.thrownCount, row);
    fill(held.heapAllocated, m.heapAllocated, row);
    fill(held.heapGross, m.heapGross, row);
    held.heapPeak = m.heapPeak[row]!;
    return held;
  };
  return {
    eventIndex: ({ row }) => eventIndex[row]!,
    text: source.text,
    namespace: source.namespace,
    callerNamespace: ({ row }) => {
      const above = parent[row]!;
      return above === NO_ROW
        ? DEFAULT_NAMESPACE
        : signatures.namespace(signatures.of(eventIndex[above]!));
    },
    type: source.type,
    usage: usageOf,
    governorCost: (node) => governorCostOf(usageOf(node), costLimits)[0],
    governorCostMax: (node) => governorCostOf(usageOf(node), costLimits)[1],
    reported: ({ row }, metric) =>
      usage?.delta(metric, { startTimestamp: start[row]!, endTimestamp: end[row]! }) ?? 0,
  };
}

/** Event `id`'s span, read from the log's columns. */
function spanOfId(log: ApexLog, id: number): TimeSpan {
  const { startTimestamp, endTimestamp } = log.columns;
  return { startTimestamp: startTimestamp[id]!, endTimestamp: endTimestamp[id]! };
}

export interface CallTreeColumnOptions {
  openType: (text: string) => void;
  /** The log's limit usage. Absent or null shows every Used cell as `—`. */
  reported?: ReportedUsage | null;
}

/** The governor metrics with a Used column, keyed by their Seen column's id prefix. */
const REPORTED_PAIRS = {
  dmlCount: { metric: 'dmlStatements', label: 'DML' },
  soqlCount: { metric: 'soqlQueries', label: 'SOQL' },
  soslCount: { metric: 'soslQueries', label: 'SOSL' },
  dmlRowCount: { metric: 'dmlRows', label: 'DML Rows' },
  soqlRowCount: { metric: 'queryRows', label: 'SOQL Rows' },
} as const satisfies Record<string, { metric: ReportedMetric; label: string }>;

type ReportedPairId = keyof typeof REPORTED_PAIRS;

type TotalKey = Exclude<keyof GovernorUsage, 'heapPeak'> | 'thrownCount';

const SEEN_DESCRIPTION = 'Counted from the log events.';
const REPORTED_DESCRIPTION = 'Our count, corrected to the limit usage Salesforce reported.';

/** How a table sums its footers. */
export interface FooterCalcs<R> {
  /** A total column's footer, from each row or, where rows overlap, from each call once. */
  total(ofRow: (row: R) => number, ofEvent: (eventIndex: number) => number): Calc<R>;
  netSelf: Calc<R>;
  grossSelf: Calc<R>;
}

export const BOTTOM_UP_SORT: GridSort = { column: 'totalSelfTime', dir: 'desc' };

function nameColumn<R>(
  log: ApexLog,
  fields: RowFields<R>,
  options: CallTreeColumnOptions,
): GridColumn<R> {
  return {
    id: 'text',
    title: 'Name',
    width: 'flex',
    minWidth: 200,
    cell: (row) => nameCell(log, fields.eventIndex(row), fields.text(row), options.openType),
    text: (row) => nameText(log, fields.eventIndex(row), fields.text(row)),
    exportText: (row) => nameExportText(log, fields.eventIndex(row), fields.text(row)),
    sort: { value: fields.text },
    sortFirst: 'desc',
    footer: 'Total',
  };
}

function namespaceColumns<R>(fields: RowFields<R>): GridColumn<R>[] {
  return [
    {
      id: 'namespace',
      title: 'Namespace',
      width: 'content',
      cell: fields.namespace,
      text: fields.namespace,
      sort: { value: fields.namespace },
      sortFirst: 'desc',
    },
    {
      id: 'callerNamespace',
      title: 'Caller Namespace',
      width: 'content',
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
    width: 'content',
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
function governorColumn<R>(opts: {
  id: string;
  title: string;
  metric: (row: R) => SelfTotal;
  part: 'total' | 'self';
  total: number;
  limit: number;
  description?: string;
  calc?: Calc<R>;
}): GridColumn<R> {
  const { total, limit } = opts;
  const value = (row: R): number => opts.metric(row)[opts.part];
  const shown = (v: number) => bar(v, total, { precision: 0, percent: false });
  return {
    id: opts.id,
    title: opts.title,
    description: opts.description,
    width: 'content',
    align: 'end',
    hidden: opts.part === 'self',
    cell: (row) => shown(value(row)),
    text: (row) => String(value(row)),
    tooltip: (row) => {
      const v = value(row);
      const share =
        total > 0
          ? `${formatInteger(v)} of ${formatInteger(total)} (${sharePercent(v, total).toFixed(1)}% of log)`
          : formatInteger(v);
      return limit > 0
        ? `${share} · ${sharePercent(v, limit).toFixed(1)}% of the ${formatInteger(limit)} limit`
        : share;
    },
    sort: { value },
    sortFirst: 'desc',
    calc: opts.calc ?? sum(value),
    total: shown,
  };
}

/**
 * What a row used of a metric, beside the Seen count it can differ from. A
 * cell that differs is tinted, and `—` stands where the log never reported the metric.
 */
function reportedColumn<R>(opts: {
  id: string;
  title: string;
  value: (row: R) => number;
  seen: (row: R) => number;
  /** The whole log's reported change, which the bar measures against; null for no usage. */
  total: number | null;
  calc: Calc<R>;
}): GridColumn<R> {
  const { value, seen, total } = opts;
  const shown = (v: number) =>
    total === null ? '—' : bar(v, total, { precision: 0, percent: false });
  return {
    id: opts.id,
    title: opts.title,
    description: REPORTED_DESCRIPTION,
    width: 'content',
    align: 'end',
    hidden: true,
    cell: (row) => {
      const v = value(row);
      const cell = shown(v);
      return total !== null && v !== seen(row)
        ? html`<div class="reported-differs">${cell}</div>`
        : cell;
    },
    text: (row) => (total === null ? '—' : String(value(row))),
    exportText: (row) => (total === null ? '' : String(value(row))),
    tooltip: (row) =>
      total === null
        ? 'No limit usage report for this in the log.'
        : `Used ${formatInteger(value(row))} · Seen ${formatInteger(seen(row))}`,
    sort: { value },
    sortFirst: 'desc',
    calc: opts.calc,
    total: shown,
  };
}

function usedOfLimit({ unit, used, limit }: GovernorCostMetric): string {
  const figure = (value: number): string => (unit === 'byte' ? formatInteger(value) : `${value}`);
  return `${figure(used)}/${figure(limit)}`;
}

/** A utilisation percentage as a bar, or `—` where the log reported no limits to measure. */
function utilisationColumn<R>(opts: {
  id: 'governorCost' | 'governorCostMax';
  title: string;
  value: (row: R) => number | null;
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
    width: 'content',
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
function heapColumn<R>(opts: {
  id: string;
  title: string;
  description: string;
  value: (row: R) => number;
  calc: Calc<R>;
  hidden?: boolean;
}): GridColumn<R> {
  const text = (row: R): string => formatInteger(opts.value(row));
  return {
    id: opts.id,
    title: opts.title,
    description: opts.description,
    width: 'content',
    align: 'end',
    hidden: opts.hidden,
    cell: text,
    text,
    tooltip: text,
    sort: { value: opts.value },
    sortFirst: 'desc',
    calc: opts.calc,
    total: formatInteger,
  };
}

/** The governor, heap and utilisation block every call-tree table shares, in display order. */
function governorMetricColumns<R>(
  log: ApexLog,
  fields: RowFields<R>,
  footer: FooterCalcs<R>,
  usage: ReportedUsage | null,
): GridColumn<R>[] {
  const limits = log.limits.final;
  const { usage: usageOf } = fields;
  const totalOf = (key: TotalKey): Calc<R> => {
    const byId = log.columns[key]?.total;
    return footer.total(
      (row) => usageOf(row)[key].total,
      (id) => byId?.[id] ?? 0,
    );
  };
  const metric = (
    id: ReportedPairId,
    total: number | undefined,
    limit: number | null,
  ): GridColumn<R>[] => {
    const of = (row: R): SelfTotal => usageOf(row)[id];
    const { metric: reportedMetric, label } = REPORTED_PAIRS[id];
    const used = (row: R): number => fields.reported(row, reportedMetric);
    return [
      governorColumn({
        id: `${id}.total`,
        title: label,
        metric: of,
        part: 'total',
        total: total ?? 0,
        limit: limit ?? 0,
        description: SEEN_DESCRIPTION,
        calc: totalOf(id),
      }),
      reportedColumn({
        id: `${id}.reported`,
        title: `${label} (used)`,
        value: used,
        seen: (row) => of(row).total,
        total: usage?.delta(reportedMetric, WHOLE_LOG) ?? null,
        calc: footer.total(used, (id) => usage?.delta(reportedMetric, spanOfId(log, id)) ?? 0),
      }),
      governorColumn({
        id: `${id}.self`,
        title: `${label} (self)`,
        metric: of,
        part: 'self',
        total: total ?? 0,
        limit: limit ?? 0,
      }),
    ];
  };
  return [
    ...metric('dmlCount', log.dmlCount?.total, limits.dmlStatements.limit),
    ...metric('soqlCount', log.soqlCount?.total, limits.soqlQueries.limit),
    ...metric('soslCount', log.soslCount?.total, limits.soslQueries.limit),
    countColumn({
      id: 'thrownCount.total',
      title: 'Throws Count',
      value: (r) => usageOf(r).thrownCount.total,
      calc: totalOf('thrownCount'),
    }),
    ...metric('dmlRowCount', log.dmlRowCount?.total, limits.dmlRows.limit),
    ...metric('soqlRowCount', log.soqlRowCount?.total, limits.queryRows.limit),
    // SOSL rows have no governor limit, so they are plain counts rather than bars.
    countColumn({
      id: 'soslRowCount.total',
      title: 'SOSL Rows',
      value: (r) => usageOf(r).soslRowCount.total,
      calc: totalOf('soslRowCount'),
    }),
    countColumn({
      id: 'soslRowCount.self',
      title: 'SOSL Rows (self)',
      value: (r) => usageOf(r).soslRowCount.self,
      hidden: true,
    }),
    heapColumn({
      id: 'heapAllocated.total',
      title: 'Heap Net (bytes)',
      description: 'Net bytes retained on this path (alloc − free); may be negative',
      value: (r) => usageOf(r).heapAllocated.total,
      calc: totalOf('heapAllocated'),
    }),
    heapColumn({
      id: 'heapAllocated.self',
      title: 'Heap Net (self, bytes)',
      description:
        'Net bytes retained directly by this node (excluding sub-methods); may be negative',
      value: (r) => usageOf(r).heapAllocated.self,
      calc: footer.netSelf,
      hidden: true,
    }),
    heapColumn({
      id: 'heapPeak',
      title: 'Heap Peak (bytes)',
      description: 'Peak live heap on this path (matches the "Maximum heap size" governor)',
      value: (r) => usageOf(r).heapPeak,
      calc: max((r) => usageOf(r).heapPeak),
    }),
    heapColumn({
      id: 'heapGross.total',
      title: 'Heap Alloc (bytes)',
      description: 'Total bytes allocated on this path (ignores frees; churn)',
      value: (r) => usageOf(r).heapGross.total,
      calc: totalOf('heapGross'),
      hidden: true,
    }),
    heapColumn({
      id: 'heapGross.self',
      title: 'Heap Alloc (self, bytes)',
      description: 'Bytes allocated directly by this node (excluding sub-methods; ignores frees)',
      value: (r) => usageOf(r).heapGross.self,
      calc: footer.grossSelf,
      hidden: true,
    }),
    utilisationColumn({
      id: 'governorCost',
      title: 'Gov Avg %',
      value: fields.governorCost,
      tooltip: (row, value) => {
        const breakdown = governorCostBreakdown(usageOf(row), log.limits);
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
      hidden: true,
      tooltip: (row, value) => {
        const [top] = governorCostBreakdown(usageOf(row), log.limits);
        return top
          ? `Tightest single governor: ${top.label} ${usedOfLimit(top)} (${value.toFixed(1)}%)`
          : `${value.toFixed(1)}%`;
      },
    }),
  ];
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
function nameLines(event: ApexEvent | null): number {
  return 1 + lineBreaks(event?.text);
}

type LinesOf = (row: { eventIndex: number }) => number;
const linesByLog = new WeakMap<ApexLog, LinesOf>();

/**
 * An Aggregated or Bottom-Up row's lines, for the grid's `rowLines`: one function per log,
 * so a render that asks again hands the grid the same one. Time Order has none: at
 * 580k rows the count cost a long task on each sort, filter and expand, and its rows are
 * nearly all 1 line.
 */
export function mergedLines(log: ApexLog): LinesOf {
  let lines = linesByLog.get(log);
  if (!lines) {
    lines = (row) => nameLines(log.event(row.eventIndex));
    linesByLog.set(log, lines);
  }
  return lines;
}

/** Opens the type a Name cell links to. */
export const openType = (text: string): void => vscodeMessenger.send<string>('openType', text);

/** The column view every Call Tree grid shares, the Analysis tab's included. */
export const CALL_TREE_COLUMN_SETTINGS: Omit<ColumnSettingsOptions, 'targets'> = {
  section: 'callTree',
  read: (settings) => settings.callTree,
  views: CALL_TREE_VIEWS,
  alwaysVisible: ['text'],
  pairs: Object.entries(REPORTED_PAIRS).map(([id, { label }]): SeenReportedPair => ({
    seen: `${id}.total`,
    reported: `${id}.reported`,
    label,
  })),
};

/** Show Details on the Bottom-Up tree. */
export const BOTTOM_UP_DETAILS: RowFilter<BottomUpRow> = { test: (row) => row._hasDetailsDeep };

/** The Bottom-Up group-by picker's options, in order, and the row field each groups on. */
export const BOTTOM_UP_GROUPS: readonly {
  label: string;
  field: 'namespace' | 'callerNamespace' | 'type' | null;
}[] = [
  { label: 'None', field: null },
  { label: 'Namespace', field: 'namespace' },
  { label: 'Caller Namespace', field: 'callerNamespace' },
  { label: 'Type', field: 'type' },
];

/** The Bottom-Up grouping for a {@link BOTTOM_UP_GROUPS} label, or null for none. */
export function bottomUpGroupBy(label: string): GroupBy<BottomUpRow> | null {
  const field = BOTTOM_UP_GROUPS.find((group) => group.label === label)?.field;
  return field ? (row) => row[field] ?? '' : null;
}

/** The Time Order columns. */
export function timeOrderColumns(
  source: TimeOrderSource,
  options: CallTreeColumnOptions,
): GridColumn<TimeOrderNode>[] {
  const { log, total, self } = source.index;
  const totalNs = log.duration.total;
  const fields = timeOrderFields(source, options.reported ?? null);
  return [
    nameColumn(log, fields, options),
    ...namespaceColumns(fields),
    typeColumn(fields, true),
    ...governorMetricColumns(
      log,
      fields,
      {
        total: (ofRow) => sum(ofRow),
        // Self never overlaps, so every row that passes the filters counts, open or not.
        netSelf: sum((r) => fields.usage(r).heapAllocated.self, 'all'),
        grossSelf: sum((r) => fields.usage(r).heapGross.self, 'all'),
      },
      options.reported ?? null,
    ),
    timeColumn<TimeOrderNode>({
      id: 'duration.total',
      title: 'Total Time (ms)',
      value: ({ row }) => total[row]!,
      totalNs,
      calc: sum(({ row }) => total[row]!),
    }),
    timeColumn<TimeOrderNode>({
      id: 'duration.self',
      title: 'Self Time (ms)',
      value: ({ row }) => self[row]!,
      totalNs,
      calc: sum(({ row }) => self[row]!, 'all'),
    }),
  ];
}

/** The Bottom-Up columns. */
export function bottomUpColumns(
  log: ApexLog,
  options: CallTreeColumnOptions,
): GridColumn<BottomUpRow>[] {
  const totalNs = log.duration.total;
  const fields = heldFields<BottomUpRow>();
  const { durationTotal } = log.columns;
  return [
    {
      ...nameColumn(log, fields, options),
      groupCell: soqlGroupCell,
    },
    ...namespaceColumns(fields),
    typeColumn(fields, false),
    countColumn<BottomUpRow>({
      id: 'callCount',
      title: 'Calls',
      value: (r) => r.callCount,
    }),
    // Bottom-up rows overlap, so totals count each call once; self never overlaps.
    ...governorMetricColumns(
      log,
      fields,
      {
        total: (_ofRow, ofEvent) => outermostSum(log, ofEvent),
        netSelf: sum((r) => r.heapAllocated.self),
        grossSelf: sum((r) => r.heapGross.self),
      },
      options.reported ?? null,
    ),
    timeColumn<BottomUpRow>({
      id: 'totalTime',
      title: 'Total Time (ms)',
      value: (r) => r.totalTime,
      totalNs,
      calc: outermostSum(log, (id) => durationTotal[id]!),
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

/** The Aggregated columns. */
export function aggregatedColumns(
  log: ApexLog,
  options: CallTreeColumnOptions,
): GridColumn<AggregatedRow>[] {
  const totalNs = log.duration.total;
  const fields = heldFields<AggregatedRow>();
  return [
    nameColumn(log, fields, options),
    ...namespaceColumns(fields),
    typeColumn(fields, true),
    countColumn<AggregatedRow>({
      id: 'callCount',
      title: 'Calls',
      value: (r) => r.callCount,
    }),
    // A callee row sits inside its caller's total; self never overlaps.
    ...governorMetricColumns(
      log,
      fields,
      {
        total: (ofRow) => sum(ofRow),
        netSelf: sum((r) => r.heapAllocated.self, 'all'),
        grossSelf: sum((r) => r.heapGross.self, 'all'),
      },
      options.reported ?? null,
    ),
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
