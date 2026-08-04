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
 * feature.
 */
const METRICS: ReadonlyArray<{ key: keyof Limits; label: string }> = [
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
  const ranked = METRICS.flatMap<RankedGauge>(({ key, label }) => {
    if (key === 'heapSize') {
      const heap = limits.heapSize;
      return heap.limit > 0 && heap.used > 0
        ? [
            {
              gauge: {
                label,
                found: heap.used,
                used: heap.used,
                limit: heap.limit,
                format: formatByteSize,
              },
              ratio: heap.used / heap.limit,
            },
          ]
        : [];
    }

    let tightest: RankedGauge | null = null;
    for (const [namespace, forNamespace] of limits.byNamespace) {
      const metric = forNamespace[key];
      if (metric.limit <= 0 || metric.used <= 0) {
        continue;
      }
      const ratio = metric.used / metric.limit;
      if (!tightest || ratio > tightest.ratio) {
        tightest = {
          gauge: {
            label: namespace === DEFAULT_NAMESPACE ? label : `${label} (${namespace})`,
            found: metric.used,
            used: metric.used,
            limit: metric.limit,
          },
          ratio,
        };
      }
    }
    return tightest ? [tightest] : [];
  });

  return ranked
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, MAX_GAUGES)
    .map((entry) => entry.gauge);
}
