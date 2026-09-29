/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { jest } from '@jest/globals';

import type { FlameChart } from '../../features/timeline/optimised/FlameChart.js';
import type { RenderDirtyState } from '../../features/timeline/types/flamechart.types.js';

/**
 * The chart's private fields, writable. Reaching past the public API is what
 * these suites are for: they drive `render` and `resize` without a canvas.
 */
export function internalsOf(chart: FlameChart): Record<string, unknown> {
  return chart as unknown as Record<string, unknown>;
}

/**
 * The private collaborators no suite varies, stubbed, and the same record back to
 * write the rest onto. `app`, `viewport` and the hit-test collaborators stay with
 * the suite, which needs a different handle on each to observe its own case.
 *
 * Naming the shared fields once means a rename inside FlameChart lands here
 * rather than in each suite.
 *
 * Every dirty flag starts false, unlike the real `init()`, so a case proves the
 * render it asked for rather than the one init already asked for. `dirty` names
 * the flags a case does depend on.
 */
export function stubChartInternals(
  chart: FlameChart,
  dirty: Partial<RenderDirtyState> = {},
): Record<string, unknown> {
  const internals = internalsOf(chart);
  internals['container'] = document.createElement('div');
  internals['index'] = { maxDepth: 1 };
  internals['worldContainer'] = { position: { set: jest.fn() } };
  internals['batchRenderer'] = { render: jest.fn(), clear: jest.fn() };
  internals['rectangleManager'] = {
    getCulledRectangles: () => ({ visibleRects: new Map(), buckets: new Map() }),
  };
  internals['state'] = {
    needsRender: false,
    batchColorsCache: new Map(),
    renderDirty: {
      background: false,
      culling: false,
      eventRendering: false,
      highlights: false,
      overlays: false,
      minimap: false,
      metricStrip: false,
      ...dirty,
    },
  };
  return internals;
}
