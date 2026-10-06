/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type {
  GovernorLimits,
  LimitMetricUnit,
  Limits,
  SelfTotal,
} from '@apexdevtools/apex-log-parser';

import { GOVERNOR_METRIC } from '../../../core/metrics/governorMetrics.js';
import { sharePercent } from '../../../core/utility/Util.js';

/**
 * The governor usage a node reports — all that's needed to *derive* cost. Both
 * the call-tree row models and the parser's `LogEvent` satisfy this, so the
 * derivations below work off either without a conversion step.
 */
export interface GovernorUsage {
  dmlCount: SelfTotal;
  soqlCount: SelfTotal;
  soslCount: SelfTotal;
  dmlRowCount: SelfTotal;
  soqlRowCount: SelfTotal;
  soslRowCount: SelfTotal;
  /** Signed net heap (alloc − free) — retention. */
  heapAllocated: SelfTotal;
  /** Gross heap allocated (positive allocations only) — churn. */
  heapGross: SelfTotal;
  /** Peak live heap (bytes) reached in this path's subtree — the limit-comparable heap value. */
  heapPeak: number;
}

/**
 * Minimal per-node metric shape needed to derive the governor cost. Every
 * call-tree row model (time-order, aggregated, bottom-up) satisfies this.
 */
export interface GovernorCostRow extends GovernorUsage {
  /**
   * Average governor consumption on this path (0–100%): the mean of every
   * governor's own `used/limit × 100`, across all governors that have a reported
   * limit (untouched ones count as 0%). A path that uses 50% of query rows and
   * 50% of DML statements — and nothing else — with five reported governors
   * scores `(50 + 50 + 0 + 0 + 0) / 5 = 20%`. `null` where the log reported no
   * limits at all: a utilisation with nothing to divide by is not 0%, it is unknown.
   */
  governorCost: number | null;
  /**
   * The single tightest governor consumed on this path (0–100+%): the max of
   * each governor's `used/limit × 100`. Flags a path near/over one specific
   * limit even when its average across governors ({@link governorCost}) is low.
   * `null` where the log reported no limits.
   */
  governorCostMax: number | null;
}

interface CostMetric {
  key: keyof Limits;
  /** Reads the node's cumulative usage for this metric. */
  used: (row: GovernorUsage) => number;
  /** The limits snapshot this metric's maximum is read from; `final` when absent. */
  snapshot?: 'peak';
}

/**
 * Metrics that are attributed per call-tree node (and therefore comparable to
 * their limit per path). CPU time and callouts are intentionally excluded —
 * they are only tracked globally, not per node. SOSL rows are also excluded:
 * they have no per-transaction limit to accumulate against (the 2,000-row cap
 * is per query) and don't count against the SOQL query-rows limit; only SOSL
 * *queries* is a transaction total (limited to 20).
 *
 * Heap uses `heapPeak` (peak live heap in the subtree), NOT `heapAllocated.total`:
 * heap is the only non-monotonic governor, so its signed net allocation can be
 * negative and does not compose against the limit. `heapPeak` is ≥ 0 and composes,
 * so it is the value comparable to the heap limit per path.
 */
const COST_METRICS: CostMetric[] = [
  { key: 'soqlQueries', used: (r) => r.soqlCount.total },
  { key: 'dmlStatements', used: (r) => r.dmlCount.total },
  { key: 'soslQueries', used: (r) => r.soslCount.total },
  { key: 'queryRows', used: (r) => r.soqlRowCount.total },
  { key: 'dmlRows', used: (r) => r.dmlRowCount.total },
  { key: 'heapSize', used: (r) => r.heapPeak, snapshot: 'peak' },
];

/** The cost metrics that carry a reported limit, each paired with it. Built by {@link costLimitsOf}. */
export type CostLimits = ReadonlyArray<CostMetric & { limit: number }>;

/**
 * Reads each cost metric's limit once per tree build, keeping only those with a reported
 * limit, for {@link setGovernorCost} to apply per row.
 */
export function costLimitsOf(limits: GovernorLimits): CostLimits {
  return COST_METRICS.map((metric) => ({
    ...metric,
    limit: limits[metric.snapshot ?? 'final'][metric.key].limit,
  })).filter((metric) => metric.limit > 0);
}

export interface GovernorCostMetric {
  label: string;
  unit: LimitMetricUnit;
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
  row: GovernorUsage,
  limits: GovernorLimits,
): GovernorCostMetric[] {
  const metrics: GovernorCostMetric[] = [];
  for (const { key, used: usedOf, limit } of costLimitsOf(limits)) {
    const used = usedOf(row);
    if (used > 0) {
      const { label, unit } = GOVERNOR_METRIC[key];
      metrics.push({ label, unit, used, limit, percent: sharePercent(used, limit) });
    }
  }
  return metrics.sort((a, b) => b.percent - a.percent);
}

/**
 * Sets {@link GovernorCostRow.governorCost} and {@link GovernorCostRow.governorCostMax}
 * on a single row from its already-aggregated totals, in one pass over the metrics. Called
 * from each tree builder at the point a row is finalized, so governor cost is computed in
 * the same pass that builds the tree (no separate traversal).
 */
export function setGovernorCost(row: GovernorCostRow, costLimits: CostLimits): void {
  let total = 0;
  let max: number | null = null;
  for (const { used, limit } of costLimits) {
    const percent = sharePercent(used(row), limit);
    total += percent;
    if (max === null || percent > max) {
      max = percent;
    }
  }
  row.governorCost = costLimits.length > 0 ? total / costLimits.length : null;
  row.governorCostMax = max;
}
