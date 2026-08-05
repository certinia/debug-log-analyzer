/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits, Limits } from 'apex-log-parser';

import { DEFAULT_NAMESPACE } from '../core/utility/CallerNamespace.js';
import { formatByteSize } from '../core/utility/Util.js';
import type { GaugeMetric } from '../features/database/components/GovernorSummary.js';

/** How many gauges the strip shows before it stops being at-a-glance. */
const MAX_GAUGES = 6;

/**
 * Every governor-tracked metric, with the label its gauge shows. A local list
 * rather than the timeline adapter's `APEX_METRICS`, which is internal to that
 * feature. Shared with the governor trend charts, so both surfaces name the
 * same metrics the same way.
 */
export const GOVERNOR_METRICS: ReadonlyArray<{ key: keyof Limits; label: string }> = [
  { key: 'cpuTime', label: 'CPU Time' },
  { key: 'heapSize', label: 'Heap Size' },
  { key: 'soqlQueries', label: 'SOQL' },
  { key: 'queryRows', label: 'Query Rows' },
  { key: 'dmlStatements', label: 'DML' },
  { key: 'dmlRows', label: 'DML Rows' },
  { key: 'soslQueries', label: 'SOSL' },
  { key: 'publishImmediateDml', label: 'Publish Immediate DML' },
  { key: 'callouts', label: 'Callouts' },
  { key: 'emailInvocations', label: 'Email Invocations' },
  { key: 'futureCalls', label: 'Future Calls' },
  { key: 'queueableJobsAddedToQueue', label: 'Queueable Jobs' },
  { key: 'mobileApexPushCalls', label: 'Mobile Push Calls' },
];

interface RankedGauge {
  gauge: GaugeMetric;
  /** Fraction of the limit consumed; ranks the strip and is then dropped. */
  ratio: number;
}

const rank = (gauge: GaugeMetric & { used: number }): RankedGauge => ({
  gauge,
  ratio: gauge.used / gauge.limit,
});

/** One namespace's final figures for a metric, with the ratio that ranked it. */
export interface TightestMetric {
  namespace: string;
  used: number;
  limit: number;
  /** used/limit as a fraction. */
  ratio: number;
}

/**
 * The namespace whose final used/limit ratio is highest for `key`, or null when
 * no namespace shows both a limit and usage. Per namespace, never the rolled-up
 * totals (#862) — see {@link tightestGauges}.
 */
export function tightestNamespaceMetric(
  limits: GovernorLimits,
  key: keyof Limits,
): TightestMetric | null {
  return [...limits.byNamespace].reduce<TightestMetric | null>(
    (tightest, [namespace, forNamespace]) => {
      const { used, limit } = forNamespace[key];
      if (limit <= 0 || used <= 0) {
        return tightest;
      }
      const ratio = used / limit;
      return !tightest || ratio > tightest.ratio ? { namespace, used, limit, ratio } : tightest;
    },
    null,
  );
}

/** A metric's display label, naming the namespace unless it is the default one. */
export function metricLabel(label: string, namespace: string): string {
  return namespace === DEFAULT_NAMESPACE ? label : `${label} (${namespace})`;
}

/**
 * The whole-log gauges closest to a limit, tightest first, capped at
 * {@link MAX_GAUGES}. A metric with no limit or no usage is left out.
 *
 * Read per namespace, never from the rolled-up totals: the roll-up sums `used`
 * across namespaces and so overstates every metric (#862). Each namespace has
 * its own budget, so the transaction's real risk is the tightest single
 * percentage — not a sum over a sum. The namespace is named in the label unless
 * it is the default one.
 *
 * Heap is the one exception: the parser stores a transaction-wide peak in the
 * roll-up, and each namespace on its own undercounts it.
 */
export function tightestGauges(limits: GovernorLimits): GaugeMetric[] {
  const ranked = GOVERNOR_METRICS.flatMap<RankedGauge>(({ key, label }) => {
    if (key === 'heapSize') {
      const heap = limits.heapSize;
      return heap.limit > 0 && heap.used > 0
        ? [
            rank({
              label,
              found: heap.used,
              used: heap.used,
              limit: heap.limit,
              format: formatByteSize,
            }),
          ]
        : [];
    }

    const tightest = tightestNamespaceMetric(limits, key);
    return tightest
      ? [
          rank({
            label: metricLabel(label, tightest.namespace),
            found: tightest.used,
            used: tightest.used,
            limit: tightest.limit,
          }),
        ]
      : [];
  });

  return ranked
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, MAX_GAUGES)
    .map((entry) => entry.gauge);
}
