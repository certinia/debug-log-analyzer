/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * How the chart draws the dim DimState picks. Which dim wins is DimState's own test.
 */

import { describe, expect, it, jest } from '@jest/globals';
import { DimState } from '../optimised/DimState.js';
import { FlameChart } from '../optimised/FlameChart.js';

function chart(options: { search?: boolean } = {}) {
  const flameChart = Object.create(FlameChart.prototype) as FlameChart;
  const internals = flameChart as unknown as Record<string, unknown>;
  const searchOrchestrator = {
    renderStyledEvents: jest.fn(),
    renderStyledLabels: jest.fn(),
    renderDimmedExcept: jest.fn(),
    renderLabelsDimmedExcept: jest.fn(),
    clearStyledEvents: jest.fn(),
    clearStyledLabels: jest.fn(),
  };
  const batchRenderer = { render: jest.fn(), clear: jest.fn() };
  const minimapOrchestrator = {
    setLitCategories: jest.fn(),
    render: jest.fn(),
    getCursorTimeNs: () => null,
  };
  const scheduleRender = jest.fn();
  internals['searchOrchestrator'] = searchOrchestrator;
  internals['batchRenderer'] = batchRenderer;
  internals['textLabelRenderer'] = { render: jest.fn() };
  internals['minimapOrchestrator'] = minimapOrchestrator;
  internals['viewport'] = { getBounds: () => ({ depthStart: 0, depthEnd: 0 }) };
  internals['markers'] = [];
  internals['dimState'] = new DimState(() => options.search ?? false);
  internals['scheduleRender'] = scheduleRender;

  const renderDirty = { culling: false, eventRendering: false, minimap: false };
  internals['state'] = { renderDirty, needsRender: false, batchColorsCache: new Map() };

  const context = { viewportState: {}, visibleRects: new Map(), buckets: new Map() };
  const draw = (): void =>
    (
      internals['renderEventsAndLabels'] as (
        viewportState: unknown,
        visibleRects: unknown,
        buckets: unknown,
        searchContext: unknown,
      ) => void
    ).call(flameChart, {}, context.visibleRects, context.buckets, context);

  const drawMinimap = (): void =>
    (internals['renderMinimap'] as (viewportState: unknown) => void).call(flameChart, {});

  return {
    flameChart,
    searchOrchestrator,
    batchRenderer,
    minimapOrchestrator,
    scheduleRender,
    renderDirty,
    draw,
    drawMinimap,
  };
}

describe('category dim on the chart', () => {
  it('dims every category but the lit ones', () => {
    const { flameChart, searchOrchestrator, batchRenderer, draw } = chart();
    const lit = new Set(['SOQL']);

    flameChart.setCategoryDim(lit);
    draw();

    expect(searchOrchestrator.renderDimmedExcept).toHaveBeenCalledWith(
      expect.anything(),
      new Set(),
      [],
      lit,
    );
    expect(searchOrchestrator.renderLabelsDimmedExcept).toHaveBeenCalledWith(
      expect.anything(),
      new Set(),
      lit,
    );
    expect(batchRenderer.clear).toHaveBeenCalled();
  });

  it('draws normally with nothing lit', () => {
    const { searchOrchestrator, batchRenderer, draw } = chart();

    draw();

    expect(searchOrchestrator.renderDimmedExcept).not.toHaveBeenCalled();
    expect(batchRenderer.render).toHaveBeenCalled();
  });

  it("draws the search's own styling when a search is on", () => {
    const { flameChart, searchOrchestrator, draw } = chart({ search: true });

    flameChart.setCategoryDim(new Set(['SOQL']));
    draw();

    expect(searchOrchestrator.renderStyledEvents).toHaveBeenCalled();
    expect(searchOrchestrator.renderDimmedExcept).not.toHaveBeenCalled();
  });

  it('recolours without re-culling, and redraws the minimap', () => {
    const { flameChart, renderDirty } = chart();

    flameChart.setCategoryDim(new Set(['DML']));

    expect(renderDirty).toEqual({ culling: false, eventRendering: true, minimap: true });
  });

  it('ignores a new set with the same members', () => {
    const { flameChart, scheduleRender } = chart();

    flameChart.setCategoryDim(new Set(['DML']));
    flameChart.setCategoryDim(new Set(['DML']));

    expect(scheduleRender).toHaveBeenCalledTimes(1);
  });

  it('redraws nothing for a legend change a search hides', () => {
    const { flameChart, scheduleRender, renderDirty } = chart({ search: true });

    flameChart.setCategoryDim(new Set(['DML']));

    expect(scheduleRender).not.toHaveBeenCalled();
    expect(renderDirty.eventRendering).toBe(false);
  });

  it('greys the minimap skyline to the lit categories', () => {
    const { flameChart, minimapOrchestrator, drawMinimap } = chart();
    const lit = new Set(['DML']);

    flameChart.setCategoryDim(lit);
    drawMinimap();

    expect(minimapOrchestrator.setLitCategories).toHaveBeenCalledWith(lit);
  });
});
