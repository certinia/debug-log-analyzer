/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as PIXI from 'pixi.js';
import { MinimapRenderer } from '../minimap/MinimapRenderer.js';

describe('MinimapRenderer static texture', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rebuilds the cached texture when only the device pixel ratio moved', () => {
    const create = jest.fn((options: { width: number; height: number; resolution: number }) => ({
      width: options.width,
      height: options.height,
      source: { resolution: options.resolution },
      destroy: jest.fn(),
    }));
    jest
      .spyOn(PIXI.RenderTexture, 'create')
      .mockImplementation(create as unknown as typeof PIXI.RenderTexture.create);

    const minimap = Object.create(MinimapRenderer.prototype) as MinimapRenderer;
    const internals = minimap as unknown as Record<string, unknown>;
    const renderer = { resolution: 1, render: jest.fn() };
    internals['backgroundGraphics'] = { clear: jest.fn() };
    internals['markerGraphics'] = { clear: jest.fn() };
    internals['axisRenderer'] = { render: jest.fn() };
    internals['staticContainer'] = {};
    // Non-null, so the texture swap takes the assignment branch and never builds a real Sprite.
    internals['staticSprite'] = { texture: null };
    internals['staticTexture'] = null;
    internals['renderer'] = renderer;
    internals['renderSkyline'] = jest.fn();
    internals['renderMarkers'] = jest.fn();

    const manager = { getState: () => ({ height: 60, displayWidth: 400 }) };
    const renderStatic = (): void =>
      (
        internals['renderStaticContent'] as (
          manager: unknown,
          densityData: unknown,
          markers: unknown,
          batchColors: unknown,
        ) => void
      ).call(minimap, manager, {}, [], new Map());

    renderStatic();
    renderer.resolution = 2;
    renderStatic();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).toMatchObject({ width: 400, height: 60, resolution: 2 });
  });
});
