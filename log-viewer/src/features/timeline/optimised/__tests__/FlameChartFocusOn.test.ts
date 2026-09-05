/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Moving the viewport must report the stretch of log it lands on. The inspector
 * reads that report, so a caller that pans or zooms without one leaves the
 * summary showing a window that is no longer on screen.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { FlameChart } from '../FlameChart.js';

/** A chart with only the viewport `focusOn` needs. `state` is left unset, so
 *  the render it asks for is a no-op. */
function stubbedChart(): {
  chart: FlameChart;
  focusOnEvent: jest.Mock;
  onViewportChange: jest.Mock;
} {
  const chart = new FlameChart();
  const focusOnEvent = jest.fn();
  const onViewportChange = jest.fn();
  const viewportState = { zoom: 2, offsetX: 40, offsetY: 0, displayWidth: 400, displayHeight: 300 };

  const internals = chart as unknown as Record<string, unknown>;
  internals['viewport'] = { focusOnEvent, getState: () => viewportState };
  internals['callbacks'] = { onViewportChange };

  return { chart, focusOnEvent, onViewportChange };
}

describe('FlameChart focusOn', () => {
  it('reports the viewport it moved to', () => {
    const { chart, focusOnEvent, onViewportChange } = stubbedChart();

    chart.focusOn(1_000, 500, 3, 0);

    expect(focusOnEvent).toHaveBeenCalledWith(1_000, 500, 3, 0);
    expect(onViewportChange).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 2, offsetX: 40 }),
    );
  });

  it('leaves the padding to the viewport when none is asked for', () => {
    const { chart, focusOnEvent } = stubbedChart();

    chart.focusOn(1_000, 500, 3);

    expect(focusOnEvent).toHaveBeenCalledWith(1_000, 500, 3, undefined);
  });

  it('does nothing before the chart has a viewport', () => {
    const { chart, onViewportChange } = stubbedChart();
    (chart as unknown as Record<string, unknown>)['viewport'] = null;

    chart.focusOn(1_000, 500, 3);

    expect(onViewportChange).not.toHaveBeenCalled();
  });
});
