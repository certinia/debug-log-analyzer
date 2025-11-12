/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * EventMeshRenderer - SIMPLIFIED VERSION
 *
 * Scale all rectangles to fit on screen, use single color, no zoom/pan.
 * Just get mesh rendering working first.
 */

import * as PIXI from 'pixi.js';
import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import { TimelineEventIndex } from '../services/TimelineEventIndex.js';
import type { MeshRenderer, MeshRendererConfig } from '../types/mesh-renderer.types.js';
import type { ViewportState } from '../types/timeline.types.js';
import { TIMELINE_CONSTANTS } from '../types/timeline.types.js';

/**
 * Pre-computed event rectangle.
 */
interface PrecomputedRect {
  timeStart: number;
  timeEnd: number;
  depth: number;
  duration: number;
  category: string;
  color: number;
}

export class EventMeshRenderer implements MeshRenderer {
  private container: PIXI.Container;
  private categoryColors: Map<string, number>;
  private rects: PrecomputedRect[] = [];
  private mesh: PIXI.Mesh<PIXI.Geometry, PIXI.Shader> | null = null;
  private shader: PIXI.Shader | null = null;
  private viewport: ViewportState;
  private index: TimelineEventIndex;

  constructor(config: MeshRendererConfig) {
    this.container = config.container as PIXI.Container;
    this.categoryColors = new Map();
    this.viewport = config.viewport;
    this.index = config.index;

    for (const [category, batch] of config.batches) {
      this.categoryColors.set(category, batch.color);
    }

    // Precompute all rectangles
    this.precomputeRectangles(config.events);

    // Build single mesh with all rectangles
    this.buildSimpleMesh();
  }

  /**
   * Flatten event tree into rectangles.
   */
  private precomputeRectangles(events: LogEvent[]): void {
    const stack: { events: LogEvent[]; depth: number }[] = [{ events, depth: 0 }];

    while (stack.length > 0) {
      const { events: currentEvents, depth } = stack.pop()!;

      for (const event of currentEvents) {
        if (event.duration.total && event.subCategory) {
          const color = this.categoryColors.get(event.subCategory) ?? 0x808080;

          this.rects.push({
            timeStart: event.timestamp,
            timeEnd: event.exitStamp ?? event.timestamp,
            depth,
            duration: event.duration.total,
            category: event.subCategory,
            color,
          });
        }

        if (event.children?.length) {
          stack.push({ events: event.children, depth: depth + 1 });
        }
      }
    }
  }

  /**
   * Build single mesh with ALL rectangles scaled to fit screen.
   */
  private buildSimpleMesh(): void {
    if (this.rects.length === 0) {
      return;
    }

    // Use raw nanosecond coordinates, apply zoom via mesh.scale
    // X: timestamp in nanoseconds (raw)
    // Y: depth * EVENT_HEIGHT in CSS pixels
    const eventHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT;
    const gap = TIMELINE_CONSTANTS.RECT_GAP;
    const halfGap = gap / 2;

    // Build vertex buffer (ALL rectangles + 1 test rectangle)
    const verticesPerRect = 4;
    const floatsPerVertex = 5; // x, y, r, g, b
    const totalRects = this.rects.length + 1; // +1 for test rectangle
    const vertices = new Float32Array(totalRects * verticesPerRect * floatsPerVertex);

    // Build index buffer
    const indicesPerRect = 6;
    const indices = new Uint32Array(totalRects * indicesPerRect);

    let vertexOffset = 0;
    let indexOffset = 0;
    let vertexIndex = 0;

    // Add test rectangle FIRST (bottom-left, 100px wide, 15px high)
    const testX1 = 0;
    const testY1 = 0;
    const testX2 = 100;
    const testY2 = 15;

    // Test rectangle: bright magenta for visibility
    vertices[vertexOffset++] = testX1;
    vertices[vertexOffset++] = testY1;
    vertices[vertexOffset++] = 1.0; // R
    vertices[vertexOffset++] = 0.0; // G
    vertices[vertexOffset++] = 1.0; // B

    vertices[vertexOffset++] = testX2;
    vertices[vertexOffset++] = testY1;
    vertices[vertexOffset++] = 1.0;
    vertices[vertexOffset++] = 0.0;
    vertices[vertexOffset++] = 1.0;

    vertices[vertexOffset++] = testX2;
    vertices[vertexOffset++] = testY2;
    vertices[vertexOffset++] = 1.0;
    vertices[vertexOffset++] = 0.0;
    vertices[vertexOffset++] = 1.0;

    vertices[vertexOffset++] = testX1;
    vertices[vertexOffset++] = testY2;
    vertices[vertexOffset++] = 1.0;
    vertices[vertexOffset++] = 0.0;
    vertices[vertexOffset++] = 1.0;

    indices[indexOffset++] = vertexIndex + 0;
    indices[indexOffset++] = vertexIndex + 1;
    indices[indexOffset++] = vertexIndex + 2;
    indices[indexOffset++] = vertexIndex + 0;
    indices[indexOffset++] = vertexIndex + 2;
    indices[indexOffset++] = vertexIndex + 3;

    vertexIndex += 4;

    // Now add all event rectangles with raw nanosecond coordinates
    for (const rect of this.rects) {
      // X coordinates: raw nanoseconds (zoom will be applied via mesh.scale.x)
      // Y coordinates: pixels
      const x1 = rect.timeStart + halfGap;
      const y1 = rect.depth * eventHeight + halfGap;
      const width = Math.max(1, rect.timeEnd - rect.timeStart - gap);
      const height = Math.max(1, eventHeight - gap);
      const x2 = x1 + width;
      const y2 = y1 + height;

      // Unpack category color (0xRRGGBB -> normalized RGB)
      const r = ((rect.color >> 16) & 0xff) / 255.0;
      const g = ((rect.color >> 8) & 0xff) / 255.0;
      const b = (rect.color & 0xff) / 255.0;

      // Vertex 0: top-left
      vertices[vertexOffset++] = x1;
      vertices[vertexOffset++] = y1;
      vertices[vertexOffset++] = r;
      vertices[vertexOffset++] = g;
      vertices[vertexOffset++] = b;

      // Vertex 1: top-right
      vertices[vertexOffset++] = x2;
      vertices[vertexOffset++] = y1;
      vertices[vertexOffset++] = r;
      vertices[vertexOffset++] = g;
      vertices[vertexOffset++] = b;

      // Vertex 2: bottom-right
      vertices[vertexOffset++] = x2;
      vertices[vertexOffset++] = y2;
      vertices[vertexOffset++] = r;
      vertices[vertexOffset++] = g;
      vertices[vertexOffset++] = b;

      // Vertex 3: bottom-left
      vertices[vertexOffset++] = x1;
      vertices[vertexOffset++] = y2;
      vertices[vertexOffset++] = r;
      vertices[vertexOffset++] = g;
      vertices[vertexOffset++] = b;

      // Triangles
      indices[indexOffset++] = vertexIndex + 0;
      indices[indexOffset++] = vertexIndex + 1;
      indices[indexOffset++] = vertexIndex + 2;
      indices[indexOffset++] = vertexIndex + 0;
      indices[indexOffset++] = vertexIndex + 2;
      indices[indexOffset++] = vertexIndex + 3;

      vertexIndex += 4;
    }

    // Create PixiJS geometry
    const geometry = new PIXI.Geometry();
    const vertexBuffer = new PIXI.Buffer({
      data: vertices,
      usage: PIXI.BufferUsage.STATIC,
    });

    geometry.addAttribute('aPosition', {
      buffer: vertexBuffer,
      size: 2,
      stride: 20,
      offset: 0,
    });

    geometry.addAttribute('aColor', {
      buffer: vertexBuffer,
      size: 3,
      stride: 20,
      offset: 8,
    });

    geometry.addIndex(indices);

    // Use PixiJS built-in matrices for projection
    const glProgram = new PIXI.GlProgram({
      vertex: `
        attribute vec2 aPosition;
        attribute vec3 aColor;

        uniform mat3 uProjectionMatrix;
        uniform mat3 uWorldTransformMatrix;
        uniform mat3 uTransformMatrix;

        varying vec3 vColor;

        void main() {
          // aPosition is already in pixels (pre-scaled on CPU)
          // Apply PixiJS transforms: projection, world transform, local transform
          mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
          vec3 position = mvp * vec3(aPosition, 1.0);

          gl_Position = vec4(position.xy, 0.0, 1.0);
          vColor = aColor;
        }
      `,
      fragment: `
        precision mediump float;
        varying vec3 vColor;

        void main() {
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
    });

    this.shader = new PIXI.Shader({
      glProgram,
      resources: {},
    });

    // Create mesh
    this.mesh = new PIXI.Mesh({
      geometry,
      shader: this.shader,
    });

    // Apply zoom via mesh scale (X only - nanoseconds to pixels)
    // Y scale stays 1.0 (already in pixels)
    this.mesh.scale.set(this.viewport.zoom, 1.0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.container.addChild(this.mesh as any);
  }

  /**
   * Render visible events for current viewport.
   */
  public render(viewport: ViewportState): void {
    // Update mesh scale to reflect current zoom
    if (this.mesh) {
      this.mesh.scale.set(viewport.zoom, 1.0);
    }
  }

  /**
   * Clean up resources.
   */
  public destroy(): void {
    if (this.mesh) {
      this.mesh.destroy();
      this.mesh = null;
    }
    this.rects = [];
  }
}
