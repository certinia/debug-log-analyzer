/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import type { GovernorLimits } from 'apex-log-parser';
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { HeatStripTimeSeries } from '../../features/timeline/types/flamechart.types.js';
import { emptyLimits, seriesEvent, timeSeries } from './limitsTestUtils.js';

// The log arrives after the first paint, which is the case this covers.
let governorLimits: GovernorLimits | null = null;
jest.mock('../../features/database/services/Database.js', () => ({
  DatabaseAccess: {
    instance: () => (governorLimits ? { getApexLog: () => ({ governorLimits }) } : null),
  },
}));

// The metric strip's series, which the overview always reads its gauges from
// so they match the timeline and the trend charts.
let mockSeries: HeatStripTimeSeries = timeSeries();
jest.mock('../../features/timeline/optimised/apex-limit-series.js', () => ({
  apexLimitTimeSeries: () => mockSeries,
}));

import { eventBus } from '../../core/events/EventBus.js';
import '../LogOverview.js';

const overview = async () => {
  const element = document.createElement('log-overview');
  document.body.append(element);
  await element.updateComplete;
  return element;
};

describe('log-overview', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    governorLimits = null;
    mockSeries = timeSeries();
  });

  it('says the totals are unknown while no log holds cumulative limits', async () => {
    const element = await overview();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain(
      'CUMULATIVE_LIMIT_USAGE',
    );
    expect(element.shadowRoot?.querySelector('governor-summary')).toBeNull();
  });

  const seriesWithSoql = (): HeatStripTimeSeries =>
    timeSeries([seriesEvent(1_000, { soqlQueries: { used: 40, limit: 100 } })]);

  it('shows the series gauges without a note while the log holds snapshots', async () => {
    const element = await overview();

    governorLimits = {
      ...emptyLimits(),
      byNamespace: new Map(),
      snapshots: [{ timestamp: 1_000, namespace: 'default', limits: emptyLimits() }],
    } as GovernorLimits;
    mockSeries = seriesWithSoql();
    eventBus.emit('log:loaded', {});
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('governor-summary')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.note')).toBeNull();
  });

  it('says the figures are estimated when cumulative limits are absent', async () => {
    const element = await overview();

    governorLimits = { ...emptyLimits(), byNamespace: new Map(), snapshots: [] } as GovernorLimits;
    mockSeries = seriesWithSoql();
    eventBus.emit('log:loaded', {});
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('governor-summary')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('estimated');
  });

  it('says the totals are unknown when the series itself is empty', async () => {
    const element = await overview();

    governorLimits = { ...emptyLimits(), byNamespace: new Map(), snapshots: [] } as GovernorLimits;
    eventBus.emit('log:loaded', {});
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('governor-summary')).toBeNull();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain(
      'CUMULATIVE_LIMIT_USAGE',
    );
  });
});
