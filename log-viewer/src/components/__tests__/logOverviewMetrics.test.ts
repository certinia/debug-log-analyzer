/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GovernorLimits, Limits } from 'apex-log-parser';
import { describe, expect, it } from '@jest/globals';

import { formatByteSize } from '../../core/utility/Util.js';
import { tightestGauges } from '../logOverviewMetrics.js';

const emptyLimits = (): Limits => ({
  soqlQueries: { used: 0, limit: 0 },
  soslQueries: { used: 0, limit: 0 },
  queryRows: { used: 0, limit: 0 },
  dmlStatements: { used: 0, limit: 0 },
  publishImmediateDml: { used: 0, limit: 0 },
  dmlRows: { used: 0, limit: 0 },
  cpuTime: { used: 0, limit: 0 },
  heapSize: { used: 0, limit: 0 },
  callouts: { used: 0, limit: 0 },
  emailInvocations: { used: 0, limit: 0 },
  futureCalls: { used: 0, limit: 0 },
  queueableJobsAddedToQueue: { used: 0, limit: 0 },
  mobileApexPushCalls: { used: 0, limit: 0 },
});

const governorLimits = (byNamespace: Map<string, Limits>, rollUp?: Partial<Limits>) =>
  ({ ...emptyLimits(), ...rollUp, byNamespace, snapshots: [] }) as GovernorLimits;

describe('tightestGauges', () => {
  it('ranks by percentage of the limit, tightest first', () => {
    const ns = emptyLimits();
    ns.soqlQueries = { used: 20, limit: 100 };
    ns.dmlStatements = { used: 120, limit: 150 };
    ns.cpuTime = { used: 500, limit: 10_000 };

    const gauges = tightestGauges(governorLimits(new Map([['default', ns]])));

    expect(gauges.map((g) => g.label)).toEqual(['DML', 'SOQL', 'CPU Time']);
    expect(gauges[0]).toEqual({ label: 'DML', found: 120, used: 120, limit: 150 });
  });

  it('takes the tightest namespace per metric, never the sum (#862)', () => {
    const first = emptyLimits();
    first.soqlQueries = { used: 60, limit: 100 };
    const second = emptyLimits();
    second.soqlQueries = { used: 90, limit: 100 };

    const gauges = tightestGauges(
      governorLimits(
        new Map([
          ['default', first],
          ['MyPackage', second],
        ]),
      ),
    );

    // 90/100, not 150/100 — and the namespace is named because it isn't default.
    expect(gauges).toEqual([{ label: 'SOQL (MyPackage)', found: 90, used: 90, limit: 100 }]);
  });

  it('reads heap from the roll-up, where the parser stores the peak', () => {
    const ns = emptyLimits();
    ns.heapSize = { used: 1_000_000, limit: 6_000_000 };

    const gauges = tightestGauges(
      governorLimits(new Map([['default', ns]]), {
        heapSize: { used: 5_400_000, limit: 6_000_000 },
      }),
    );

    expect(gauges).toEqual([
      {
        label: 'Heap Size',
        found: 5_400_000,
        used: 5_400_000,
        limit: 6_000_000,
        // Bytes are written compactly; the raw figures do not fit a gauge.
        format: formatByteSize,
      },
    ]);
    expect(gauges[0]?.format?.(5_400_000)).toBe('5.4 MB');
  });

  it('drops metrics with no limit or no usage, and caps the strip at six', () => {
    const ns = emptyLimits();
    ns.soqlQueries = { used: 10, limit: 0 };
    ns.dmlStatements = { used: 0, limit: 150 };
    ns.cpuTime = { used: 1, limit: 10_000 };
    ns.queryRows = { used: 2, limit: 50_000 };
    ns.dmlRows = { used: 3, limit: 10_000 };
    ns.soslQueries = { used: 4, limit: 20 };
    ns.callouts = { used: 5, limit: 100 };
    ns.futureCalls = { used: 6, limit: 50 };
    ns.emailInvocations = { used: 7, limit: 10 };

    const gauges = tightestGauges(governorLimits(new Map([['default', ns]])));

    expect(gauges).toHaveLength(6);
    expect(gauges.map((g) => g.label)).not.toContain('SOQL');
    expect(gauges.map((g) => g.label)).not.toContain('DML');
  });

  it('returns nothing when no namespace reported any limits', () => {
    expect(tightestGauges(governorLimits(new Map()))).toEqual([]);
  });
});
