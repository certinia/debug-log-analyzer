/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type * as PIXI from 'pixi.js';

/**
 * Tears down one of the timeline's Pixi apps.
 *
 * `removeView`, never a bare `true`: a bare `true` also releases Pixi's global resources,
 * and TexturePool is one of them. A timeline runs three apps, so releasing on the first
 * destroy empties the pool the other two still return their text textures to.
 */
export function destroyTimelineApp(app: PIXI.Application): void {
  app.destroy({ removeView: true }, { children: true, texture: true });
}
