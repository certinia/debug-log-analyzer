/**
 * @vitest-environment jsdom
 */

/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as PIXI from 'pixi.js';
import { MinimapRenderer } from '../minimap/MinimapRenderer.js';

describe('MinimapRenderer static texture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rebuilds the cached texture when only the device pixel ratio moved', () => {
    const create = vi.fn((options: { width: number; height: number; resolution: number }) => ({
      width: options.width,
      height: options.height,
      source: { resolution: options.resolution },
      destroy: vi.fn(),
    }));
    vi.spyOn(PIXI.RenderTexture, 'create').mockImplementation(
      create as unknown as typeof PIXI.RenderTexture.create,
    );

    const minimap = Object.create(MinimapRenderer.prototype) as MinimapRenderer;
    const internals = minimap as unknown as Record<string, unknown>;
    const renderer = { resolution: 1, render: vi.fn() };
    internals['backgroundGraphics'] = { clear: vi.fn() };
    internals['markerGraphics'] = { clear: vi.fn() };
    internals['axisRenderer'] = { render: vi.fn() };
    internals['staticContainer'] = {};
    // Non-null, so the texture swap takes the assignment branch and never builds a real Sprite.
    internals['staticSprite'] = { texture: null };
    internals['staticTexture'] = null;
    internals['renderer'] = renderer;
    internals['renderSkyline'] = vi.fn();
    internals['renderMarkers'] = vi.fn();

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
