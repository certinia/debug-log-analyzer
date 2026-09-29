/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Stepping through find results centres the view on each match, which moves the frames under a
 * still pointer. The chart asks what the pointer is over again, and the answer used to take the
 * match's own panel away — so the panel appeared only when the pointer happened to rest outside
 * the chart. It is held until the reader moves the pointer, and closing the find drops it.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApexLogTimeline } from '../optimised/ApexLogTimeline.js';
import type { EventNode, HoverCause, TimelineMarker } from '../types/flamechart.types.js';

const MATCH: EventNode = {
  id: '0-0-0',
  timestamp: 1000,
  duration: 500,
  type: 'METHOD_ENTRY',
  text: 'Match()',
  original: { eventIndex: 7, isParent: true },
};

type Tooltip = { show: jest.Mock; showTruncation: jest.Mock; hide: jest.Mock };

function timeline(): {
  navigateToMatch: () => void;
  hover: (eventNode: EventNode | null, cause: HoverCause) => void;
  closeFind: () => void;
  deselect: () => void;
  tooltip: Tooltip;
} {
  const chart = new ApexLogTimeline();
  const internals = chart as unknown as Record<string, unknown>;
  const tooltip: Tooltip = { show: jest.fn(), showTruncation: jest.fn(), hide: jest.fn() };

  internals['tooltipRenderer'] = tooltip;
  internals['flamechart'] = {
    containerYToDepth: () => 0,
    getFrameRect: () => ({ x: 10, y: 20, width: 30, height: 15 }),
    getChartTopY: () => 40,
    clearSearch: jest.fn(),
    locateByEventNodes: jest.fn(),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  internals['container'] = container;

  const navigate = internals['handleSearchNavigate'] as (
    eventNode: EventNode,
    screenX: number,
    screenY: number,
    depth: number,
  ) => void;
  const mouseMove = internals['handleMouseMove'] as (
    screenX: number,
    screenY: number,
    eventNode: EventNode | null,
    marker: TimelineMarker | null,
    cause: HoverCause,
  ) => void;
  const findClose = internals['handleFindClose'] as () => void;
  const select = internals['handleSelect'] as (eventNode: EventNode | null) => void;

  return {
    navigateToMatch: () => navigate.call(chart, MATCH, 200, 100, 0),
    hover: (eventNode, cause) => mouseMove.call(chart, 50, 60, eventNode, null, cause),
    closeFind: () => findClose.call(chart),
    deselect: () => select.call(chart, null),
    tooltip,
  };
}

describe('the panel on a find match', () => {
  let chart: ReturnType<typeof timeline>;

  beforeEach(() => {
    chart = timeline();
    chart.navigateToMatch();
    expect(chart.tooltip.show).toHaveBeenCalledTimes(1);
  });

  it('survives the re-hit the centring causes under a still pointer', () => {
    chart.hover(null, 'frames');

    expect(chart.tooltip.hide).not.toHaveBeenCalled();
  });

  it('is not replaced by whatever the frames slid under the pointer', () => {
    chart.hover({ ...MATCH, id: 'other', original: { eventIndex: 9 } }, 'frames');

    expect(chart.tooltip.show).toHaveBeenCalledTimes(1);
  });

  it('is handed back on the next real pointer move', () => {
    chart.hover(null, 'pointer');

    expect(chart.tooltip.hide).toHaveBeenCalledTimes(1);
  });

  it('goes when the find closes', () => {
    chart.closeFind();

    expect(chart.tooltip.hide).toHaveBeenCalledTimes(1);
  });

  // Escape closes the panel without moving the pointer. Nothing is held after that, so the
  // next zoom or pan shows the frame the pointer ended up over.
  it('holds nothing once something else closed it', () => {
    chart.deselect();
    chart.tooltip.show.mockClear();

    chart.hover({ ...MATCH, id: 'other', original: { eventIndex: 9 } }, 'frames');

    expect(chart.tooltip.show).toHaveBeenCalledTimes(1);
  });
});
