/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits, SelfTotal } from 'apex-log-parser';

/**
 * Minimal per-node metric shape needed to derive the governor cost. Every
 * call-tree row model (time-order, aggregated, bottom-up) satisfies this.
 */
export interface GovernorCostRow {
  dmlCount: SelfTotal;
  soqlCount: SelfTotal;
  soslCount: SelfTotal;
  dmlRowCount: SelfTotal;
  soqlRowCount: SelfTotal;
  soslRowCount: SelfTotal;
  heapAllocated: SelfTotal;
  /**
   * Average governor consumption on this path (0–100%): the mean of every
   * governor's own `used/limit × 100`, across all governors that have a reported
   * limit (untouched ones count as 0%). A path that uses 50% of query rows and
   * 50% of DML statements — and nothing else — with five reported governors
   * scores `(50 + 50 + 0 + 0 + 0) / 5 = 20%`.
   */
  governorCost: number;
  /**
   * The single tightest governor consumed on this path (0–100+%): the max of
   * each governor's `used/limit × 100`. Flags a path near/over one specific
   * limit even when its average across governors ({@link governorCost}) is low.
   */
  governorCostMax: number;
}

interface CostMetric {
  label: string;
  /** Reads the node's cumulative usage for this metric. */
  used: (row: GovernorCostRow) => number;
  /** Reads the log's maximum for this metric. */
  limit: (limits: GovernorLimits) => number;
}

/**
 * Metrics that are attributed per call-tree node (and therefore comparable to
 * their limit per path). CPU time and callouts are intentionally excluded —
 * they are only tracked globally, not per node.
 */
const COST_METRICS: CostMetric[] = [
  { label: 'SOQL', used: (r) => r.soqlCount.total, limit: (l) => l.soqlQueries.limit },
  { label: 'DML', used: (r) => r.dmlCount.total, limit: (l) => l.dmlStatements.limit },
  { label: 'SOSL', used: (r) => r.soslCount.total, limit: (l) => l.soslQueries.limit },
  { label: 'SOQL Rows', used: (r) => r.soqlRowCount.total, limit: (l) => l.queryRows.limit },
  { label: 'DML Rows', used: (r) => r.dmlRowCount.total, limit: (l) => l.dmlRows.limit },
  { label: 'SOSL Rows', used: (r) => r.soslRowCount.total, limit: (l) => l.queryRows.limit },
  { label: 'Heap', used: (r) => r.heapAllocated.total, limit: (l) => l.heapSize.limit },
];

/**
 * Average governor consumption on this path (0–100%): the mean of each
 * governor's own `used/limit × 100`, over every governor with a reported limit
 * (limit > 0). Governors the path didn't touch count as 0% and still divide the
 * total, so this measures overall governor utilisation across all of them, not
 * the single tightest one. Governors never reported in the log (limit 0) are
 * excluded from both the sum and the divisor.
 */
export function governorCost(row: GovernorCostRow, limits: GovernorLimits): number {
  let total = 0;
  let count = 0;
  for (const metric of COST_METRICS) {
    const limit = metric.limit(limits);
    if (limit > 0) {
      total += (metric.used(row) / limit) * 100;
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

/**
 * The single tightest governor consumed on this path (0–100+%): the max of each
 * governor's `used/limit × 100`, over governors with a reported limit. The
 * "am I about to breach one specific limit" signal, complementing the averaged
 * {@link governorCost}.
 */
export function governorCostMax(row: GovernorCostRow, limits: GovernorLimits): number {
  let max = 0;
  for (const metric of COST_METRICS) {
    const limit = metric.limit(limits);
    if (limit > 0) {
      const percent = (metric.used(row) / limit) * 100;
      if (percent > max) {
        max = percent;
      }
    }
  }
  return max;
}

export interface GovernorCostMetric {
  label: string;
  used: number;
  limit: number;
  /** This metric's own `used/limit × 100` contribution to the total. */
  percent: number;
}

/**
 * Per-metric contributions to a row's governor cost — every consumed metric
 * (used > 0 with a known limit), highest contribution first. Used to show the
 * breakdown behind the summed Gov. Cost figure in the column tooltip.
 */
export function governorCostBreakdown(
  row: GovernorCostRow,
  limits: GovernorLimits,
): GovernorCostMetric[] {
  const metrics: GovernorCostMetric[] = [];
  for (const metric of COST_METRICS) {
    const limit = metric.limit(limits);
    const used = metric.used(row);
    if (limit > 0 && used > 0) {
      metrics.push({ label: metric.label, used, limit, percent: (used / limit) * 100 });
    }
  }
  return metrics.sort((a, b) => b.percent - a.percent);
}

/**
 * Populates {@link GovernorCostRow.governorCost} across a call-tree row array
 * and its `_children`. Runs once after the tree is built — governor cost is a
 * pure function of already-aggregated totals, so it lives in the call-tree
 * layer rather than the parser.
 */
export function annotateGovernorCost<T extends GovernorCostRow & { _children?: T[] | null }>(
  rows: T[] | null | undefined,
  limits: GovernorLimits,
): void {
  if (!rows) {
    return;
  }
  for (const row of rows) {
    row.governorCost = governorCost(row, limits);
    row.governorCostMax = governorCostMax(row, limits);
    annotateGovernorCost(row._children, limits);
  }
}
