/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import type { GovernorLimits } from '@apexdevtools/apex-log-parser/types';
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { LogStore } from '../../core/log/LogStore.js';
import type { HeatStripTimeSeries } from '../../features/timeline/types/flamechart.types.js';
import { governorLimits, seriesEvent, timeSeries } from './limitsTestUtils.js';

// The metric strip's series, which the overview always reads its gauges from
// so they match the timeline and the trend charts.
let mockSeries: HeatStripTimeSeries = timeSeries();
jest.mock('../../features/timeline/optimised/apex-limit-series.js', () => ({
  apexLimitTimeSeries: () => mockSeries,
}));

import type { LogOverview } from '../LogOverview.js';
import '../LogOverview.js';

const overview = async () => {
  const element = document.createElement('log-overview');
  document.body.append(element);
  await element.updateComplete;
  return element;
};

/** No provider in the test, so the consumed store is assigned straight on. */
const loadLog = async (element: LogOverview, governorLimits: GovernorLimits) => {
  element.logStore = { log: { governorLimits } } as unknown as LogStore;
  await element.updateComplete;
};

describe('log-overview', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    mockSeries = timeSeries();
  });

  const noLog = governorLimits();

  const seriesWithSoql = (limit: number): HeatStripTimeSeries =>
    timeSeries([seriesEvent(1_000, { soqlQueries: { used: 40, limit } })]);

  it('waits on the log rather than naming one that has not arrived', async () => {
    const element = await overview();

    // Which sentence a skeleton settles on is SectionSkeleton's own business.
    expect(element.shadowRoot?.querySelector('section-skeleton')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('governor-summary')).toBeNull();
  });

  it('shows the gauges without a note while the log reports a limit', async () => {
    const element = await overview();

    mockSeries = seriesWithSoql(100);
    await loadLog(element, noLog);

    expect(element.shadowRoot?.querySelector('governor-summary')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.note')).toBeNull();
  });

  // Figures still show where the log reported no limit; the gauge says so on hover, so the strip
  // carries no note of its own.
  it('shows the gauges with no note when the log reported no limits', async () => {
    const element = await overview();

    mockSeries = seriesWithSoql(0);
    await loadLog(element, noLog);

    expect(element.shadowRoot?.querySelector('governor-summary')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.note')).toBeNull();
  });

  it('says nothing was recorded when the series itself is empty', async () => {
    const element = await overview();

    await loadLog(element, noLog);

    expect(element.shadowRoot?.querySelector('governor-summary')).toBeNull();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('no governor usage');
  });
});
