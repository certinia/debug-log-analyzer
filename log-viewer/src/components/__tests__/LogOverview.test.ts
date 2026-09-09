/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import type { GovernorLimits } from 'apex-log-parser';
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { LogStore } from '../../core/log/LogStore.js';
import type { HeatStripTimeSeries } from '../../features/timeline/types/flamechart.types.js';
import { emptyLimits, seriesEvent, timeSeries } from './limitsTestUtils.js';

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

  const noLog = { ...emptyLimits(), byNamespace: new Map(), snapshots: [] } as GovernorLimits;

  const seriesWithSoql = (limit: number): HeatStripTimeSeries =>
    timeSeries([seriesEvent(1_000, { soqlQueries: { used: 40, limit } })]);

  it('says nothing was recorded while no log is loaded', async () => {
    const element = await overview();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('no governor usage');
    expect(element.shadowRoot?.querySelector('governor-summary')).toBeNull();
  });

  it('shows the gauges without a note while the log reports a limit', async () => {
    const element = await overview();

    mockSeries = seriesWithSoql(100);
    await loadLog(element, noLog);

    expect(element.shadowRoot?.querySelector('governor-summary')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.note')).toBeNull();
  });

  // The log, not a snapshot count, decides: figures still show, but nothing is a share of a limit.
  it('says no limits were reported when the log reported none', async () => {
    const element = await overview();

    mockSeries = seriesWithSoql(0);
    await loadLog(element, noLog);

    expect(element.shadowRoot?.querySelector('governor-summary')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('no governor limits');
  });

  it('says nothing was recorded when the series itself is empty', async () => {
    const element = await overview();

    await loadLog(element, noLog);

    expect(element.shadowRoot?.querySelector('governor-summary')).toBeNull();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('no governor usage');
  });
});
