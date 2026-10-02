/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Mesh } from 'pixi.js';

/** One drawn rectangle, in clip space, with its colour unpacked to 0xRRGGBB. */
export interface DrawnQuad {
  left: number;
  right: number;
  top: number;
  bottom: number;
  color: number;
  alpha: number;
}

/** Reads every rectangle back out of a rectangle mesh's vertex buffers. */
export function readQuads(mesh: Mesh): DrawnQuad[] {
  const positions = mesh.geometry.getAttribute('aPosition').buffer.data as Float32Array;
  const colors = mesh.geometry.getAttribute('aColor').buffer.data as Uint32Array;
  const quads: DrawnQuad[] = [];
  // Each rect is 6 vertices: 12 position floats and 6 colours, so every index below is in range.
  for (let i = 0; i < colors.length / 6; i++) {
    const p = i * 12;
    const packed = colors[i * 6]!;
    quads.push({
      left: positions[p]!,
      right: positions[p + 2]!,
      top: positions[p + 1]!,
      bottom: positions[p + 5]!,
      color: ((packed & 0xff) << 16) | (((packed >>> 8) & 0xff) << 8) | ((packed >>> 16) & 0xff),
      alpha: packed >>> 24,
    });
  }
  return quads;
}
