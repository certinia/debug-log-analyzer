/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import type { GovernorLimits } from 'apex-log-parser';
import { beforeEach, describe, expect, it } from '@jest/globals';

import { emptyLimits } from './limitsTestUtils.js';

// The log arrives after the first paint, which is the case this covers.
let governorLimits: GovernorLimits | null = null;
jest.mock('../../features/database/services/Database.js', () => ({
  DatabaseAccess: {
    instance: () => (governorLimits ? { getApexLog: () => ({ governorLimits }) } : null),
  },
}));

import { eventBus } from '../../core/events/EventBus.js';
import '../LogOverview.js';

const overview = async () => {
  const element = document.createElement('log-overview');
  element.source = 'timeline';
  document.body.append(element);
  await element.updateComplete;
  return element;
};

describe('log-overview', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    governorLimits = null;
  });

  it('says the totals are unknown while no log holds cumulative limits', async () => {
    const element = await overview();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain(
      'no cumulative limit usage',
    );
    expect(element.shadowRoot?.querySelector('governor-summary')).toBeNull();
  });

  it('shows the gauges once the log is parsed, without a selection', async () => {
    const element = await overview();

    const namespace = emptyLimits();
    namespace.soqlQueries = { used: 40, limit: 100 };
    governorLimits = {
      ...emptyLimits(),
      byNamespace: new Map([['default', namespace]]),
      snapshots: [],
    } as GovernorLimits;
    eventBus.emit('log:loaded', {});
    await element.updateComplete;

    expect(element.shadowRoot?.querySelector('governor-summary')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.note')).toBeNull();
  });

  it('names what to select for the source it follows', async () => {
    const element = await overview();
    expect(element.shadowRoot?.querySelector('.hint')?.textContent).toContain('timeline');
  });
});
