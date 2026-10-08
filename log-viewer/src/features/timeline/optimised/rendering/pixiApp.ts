/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import * as PIXI from 'pixi.js';

/**
 * One of the timeline's Pixi apps, drawing into `parent`: ticker stopped, so every
 * repaint is one the caller asked for; stage deaf to pointer events, which the host
 * element handles; canvas appended. `antialias` defaults off — only the metric strip
 * draws lines that need it.
 */
export async function createTimelineApp(
  parent: HTMLElement,
  options: { width: number; height: number; antialias?: boolean },
): Promise<PIXI.Application> {
  const app = new PIXI.Application();
  await app.init({
    width: options.width,
    height: options.height,
    antialias: options.antialias ?? false,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio || 1,
    roundPixels: true,
    autoDensity: true,
    autoStart: false,
    // Pixi 8.22 made Tab anywhere in the page switch on its accessibility layer; we use none.
    accessibilityOptions: { activateOnTab: false },
  });
  app.ticker.stop();
  app.stage.eventMode = 'none';
  parent.appendChild(app.canvas);
  return app;
}

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
