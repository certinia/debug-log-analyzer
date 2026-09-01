/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Collapsing or expanding the strip changes the main timeline's height, so the host relayouts
 * and draws as part of that. Asking it to draw again is a second full render for one click.
 */

import { describe, expect, it, jest } from '@jest/globals';
import {
  MetricStripOrchestrator,
  type MetricStripOrchestratorCallbacks,
} from '../metric-strip/MetricStripOrchestrator.js';

function orchestrator(): {
  strip: MetricStripOrchestrator;
  onHeightChange: jest.Mock;
  requestRender: jest.Mock;
} {
  const onHeightChange = jest.fn();
  const requestRender = jest.fn();
  const callbacks = {
    onZoomToRegion: jest.fn(),
    onCursorMove: jest.fn(),
    requestRender,
    requestCursorRender: jest.fn(),
    onHeightChange,
  } as unknown as MetricStripOrchestratorCallbacks;

  return { strip: new MetricStripOrchestrator(callbacks), onHeightChange, requestRender };
}

describe('collapsing the metric strip', () => {
  it('asks the host to relayout, and does not also ask it to draw', () => {
    const { strip, onHeightChange, requestRender } = orchestrator();

    strip.toggleCollapsed();

    expect(onHeightChange).toHaveBeenCalledTimes(1);
    expect(requestRender).not.toHaveBeenCalled();
  });
});
