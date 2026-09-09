/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { NO_REPORTED_LIMITS_TEXT } from '../GovernorSummary.js';
import type { GaugeMetric, GovernorSummary } from '../GovernorSummary.js';
import '../GovernorSummary.js';

const strip = async (metrics: GaugeMetric[]) => {
  const element = document.createElement('governor-summary') as GovernorSummary;
  element.metrics = metrics;
  document.body.append(element);
  await element.updateComplete;
  return element;
};

describe('governor-summary', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  describe('a limit the log reported', () => {
    it('meters the value against it', async () => {
      const element = await strip([{ label: 'SOQL', found: 40, used: 40, limit: 100 }]);
      const gauge = element.shadowRoot?.querySelector('.gauge');

      expect(gauge?.getAttribute('role')).toBe('meter');
      expect(gauge?.getAttribute('aria-valuemax')).toBe('100');
      expect(gauge?.querySelector('.gauge__fill')).not.toBeNull();
      expect(gauge?.querySelector('.gauge__spark')).toBeNull();
    });
  });

  describe('no limit reported', () => {
    const spark: GaugeMetric = { label: 'SOQL', found: 12, used: 12, limit: 0, spark: [3, 6, 12] };

    // A bar against the level's own peak would sit full, which is how the strip says "breached".
    it('draws no bar and claims no meter', async () => {
      const element = await strip([spark]);
      const gauge = element.shadowRoot?.querySelector('.gauge');

      expect(gauge?.getAttribute('role')).toBeNull();
      expect(gauge?.querySelector('.gauge__track')).toBeNull();
      expect(gauge?.textContent).toContain('12');
    });

    // The missing denominator says there is no limit; the hover says why, so the host needs no
    // note under the strip.
    it('says why it has no bar, on hover', async () => {
      const element = await strip([spark]);

      expect(element.shadowRoot?.querySelector('.gauge')?.getAttribute('title')).toBe(
        NO_REPORTED_LIMITS_TEXT,
      );
    });

    it('draws the level scaled to its own peak, described rather than metered', async () => {
      const element = await strip([spark]);
      const svg = element.shadowRoot?.querySelector('.gauge__spark');

      expect(svg?.getAttribute('aria-label')).toContain('highest point 12');
      // 3, 6 and 12 of a 12 peak, in a 0-10 box: three quarters, half, then the top.
      expect(svg?.querySelector('polyline')?.getAttribute('points')).toBe(
        '0.00,7.50 50.00,5.00 100.00,0.00',
      );
    });

    it('draws nothing where the host passed no readings', async () => {
      const element = await strip([{ label: 'SOQL', found: 12, used: 12, limit: 0 }]);

      expect(element.shadowRoot?.querySelector('.gauge__spark')).toBeNull();
    });
  });
});
