/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The skyline, markers and axis are cached into one RenderTexture. A ratio change leaves the
 * minimap's box alone, so only the texture's own resolution says the cache is stale.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as PIXI from 'pixi.js';
import { MinimapRenderer } from '../minimap/MinimapRenderer.js';

/** The collaborators the static path touches, and nothing else. */
function stubbedRenderer(): {
  renderStatic: () => void;
  setResolution: (value: number) => void;
} {
  const minimap = Object.create(MinimapRenderer.prototype) as MinimapRenderer;
  const internals = minimap as unknown as Record<string, unknown>;

  internals['backgroundGraphics'] = { clear: jest.fn() };
  internals['markerGraphics'] = { clear: jest.fn() };
  internals['axisRenderer'] = { render: jest.fn() };
  internals['container'] = { addChildAt: jest.fn() };
  internals['staticContainer'] = {};
  // Non-null, so the texture swap takes the assignment branch and never builds a real Sprite.
  internals['staticSprite'] = { texture: null };
  internals['staticTexture'] = null;
  internals['renderer'] = { resolution: 1, render: jest.fn() };
  internals['renderSkyline'] = jest.fn();
  internals['renderMarkers'] = jest.fn();

  const manager = { getState: () => ({ height: 60, displayWidth: 400 }) };
  const renderStaticContent = internals['renderStaticContent'] as (
    manager: unknown,
    densityData: unknown,
    markers: unknown,
    batchColors: unknown,
  ) => void;

  return {
    renderStatic: () => renderStaticContent.call(minimap, manager, {}, [], new Map()),
    setResolution: (value: number) => {
      (internals['renderer'] as { resolution: number }).resolution = value;
    },
  };
}

describe('MinimapRenderer static texture', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function spyOnCreate(): jest.Mock {
    const create = jest.fn((options: { width: number; height: number; resolution: number }) => ({
      width: options.width,
      height: options.height,
      source: { resolution: options.resolution },
      destroy: jest.fn(),
    }));
    jest
      .spyOn(PIXI.RenderTexture, 'create')
      .mockImplementation(create as unknown as typeof PIXI.RenderTexture.create);
    return create as unknown as jest.Mock;
  }

  it('rebuilds the cached texture when only the device pixel ratio moved', () => {
    const create = spyOnCreate();
    const { renderStatic, setResolution } = stubbedRenderer();

    renderStatic();
    expect(create).toHaveBeenCalledTimes(1);

    // Same box, new ratio: the texture is the only thing that knows it is stale.
    setResolution(2);
    renderStatic();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).toMatchObject({ width: 400, height: 60, resolution: 2 });
  });

  it('keeps the cached texture when nothing moved', () => {
    const create = spyOnCreate();
    const { renderStatic } = stubbedRenderer();

    renderStatic();
    renderStatic();

    expect(create).toHaveBeenCalledTimes(1);
  });
});
