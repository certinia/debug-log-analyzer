/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * MinimapBarGeometry
 *
 * Manages PixiJS Geometry for efficient vertical bar rendering in the minimap.
 * Specialized for the minimap's RenderTexture context where bars represent
 * density/depth information per time bucket.
 *
 * Performance optimizations:
 * - Grow-only buffer strategy (avoids GC from reallocations)
 * - Direct typed array access for fast buffer filling
 * - Single geometry instance reused each frame
 * - Pre-transforms to clip-space for the RenderTexture
 *
 * Coordinate system:
 * - Input: Screen coordinates (0 to displayWidth, 0 to displayHeight)
 * - Output: Clip-space for RenderTexture (-1 to 1)
 */

import { Buffer, Geometry } from 'pixi.js';

/** Initial capacity in number of bars */
const INITIAL_CAPACITY = 1024;

/** Growth factor when capacity is exceeded */
const GROWTH_FACTOR = 2;

/** Vertices per bar (6 for 2 triangles, non-indexed) */
const VERTICES_PER_BAR = 6;

/** Floats per vertex for position (x, y) */
const FLOATS_PER_POSITION = 2;

/**
 * MinimapBarGeometry - Efficient geometry management for minimap bar rendering.
 *
 * Uses non-indexed geometry (6 vertices per bar) for maximum compatibility
 * with PixiJS 8's custom shader rendering pipeline.
 */
export class MinimapBarGeometry {
  /** PixiJS Geometry instance */
  private geometry: Geometry;

  /** PixiJS Buffer for positions */
  private positionBuffer: Buffer;

  /** PixiJS Buffer for colors */
  private colorBuffer: Buffer;

  /** Typed array for position data (2 floats per vertex, 6 vertices per bar) */
  private positionData: Float32Array;

  /** Typed array for color data (1 uint32 per vertex, 6 vertices per bar) */
  private colorData: Uint32Array;

  /** Current capacity in number of bars */
  private capacity: number = 0;

  /** Display width for clip-space conversion */
  private displayWidth: number = 0;

  /** Display height for clip-space conversion */
  private displayHeight: number = 0;

  /**
   * Create a new MinimapBarGeometry.
   */
  constructor() {
    // Initialize with default capacity
    this.positionData = new Float32Array(INITIAL_CAPACITY * VERTICES_PER_BAR * FLOATS_PER_POSITION);
    this.colorData = new Uint32Array(INITIAL_CAPACITY * VERTICES_PER_BAR);
    this.capacity = INITIAL_CAPACITY;

    // Create PixiJS buffers for vertex attributes
    this.positionBuffer = new Buffer({
      data: this.positionData,
      usage: 1, // BufferUsage.VERTEX
    });

    this.colorBuffer = new Buffer({
      data: this.colorData,
      usage: 1, // BufferUsage.VERTEX
    });

    // Create geometry with attributes (NO index buffer - using non-indexed rendering)
    this.geometry = new Geometry({
      attributes: {
        aPosition: {
          buffer: this.positionBuffer,
          format: 'float32x2',
          stride: FLOATS_PER_POSITION * 4,
          offset: 0,
        },
        aColor: {
          buffer: this.colorBuffer,
          format: 'unorm8x4',
          stride: 4,
          offset: 0,
        },
      },
    });
  }

  /**
   * Set the display dimensions for clip-space conversion.
   * Must be called before writeBar() when dimensions change.
   *
   * @param width - Display width in pixels
   * @param height - Display height in pixels
   */
  public setDisplayDimensions(width: number, height: number): void {
    this.displayWidth = width;
    this.displayHeight = height;
  }

  /**
   * Ensure buffers have capacity for at least the given number of bars.
   *
   * @param barCount - Required number of bars
   */
  public ensureCapacity(barCount: number): void {
    if (barCount <= this.capacity) {
      return;
    }

    let newCapacity = this.capacity * GROWTH_FACTOR;
    while (newCapacity < barCount) {
      newCapacity *= GROWTH_FACTOR;
    }

    const newPositionData = new Float32Array(newCapacity * VERTICES_PER_BAR * FLOATS_PER_POSITION);
    const newColorData = new Uint32Array(newCapacity * VERTICES_PER_BAR);

    newPositionData.set(this.positionData);
    newColorData.set(this.colorData);

    this.positionData = newPositionData;
    this.colorData = newColorData;
    this.capacity = newCapacity;

    this.positionBuffer.data = this.positionData;
    this.colorBuffer.data = this.colorData;
  }

  /**
   * Write a vertical bar to the buffers at the given index.
   * Bars grow upward from the bottom (y = displayHeight).
   *
   * @param barIndex - Bar index (0-based)
   * @param x - Left edge X in screen coordinates
   * @param width - Bar width in screen coordinates
   * @param height - Bar height in screen coordinates (grows up from bottom)
   * @param bottomY - Y coordinate of bar bottom (typically chartBottom)
   * @param color - PixiJS color (0xRRGGBB)
   * @param alpha - Opacity (0-1), default 1.0
   */
  public writeBar(
    barIndex: number,
    x: number,
    width: number,
    height: number,
    bottomY: number,
    color: number,
    alpha: number = 1.0,
  ): void {
    const positionOffset = barIndex * VERTICES_PER_BAR * FLOATS_PER_POSITION;
    const colorOffset = barIndex * VERTICES_PER_BAR;

    // Screen coordinates
    const screenX1 = x;
    const screenX2 = x + width;
    const screenY1 = bottomY - height; // Top of bar (grows upward)
    const screenY2 = bottomY; // Bottom of bar

    // Convert screen coordinates to clip space (-1 to 1)
    // Screen: X 0→displayWidth, Y 0→displayHeight (Y=0 at top)
    // WebGL RenderTexture: Y=0 at BOTTOM of framebuffer, so we use standard
    // clip-space conversion without flipping Y
    const clipX1 = (screenX1 / this.displayWidth) * 2 - 1;
    const clipX2 = (screenX2 / this.displayWidth) * 2 - 1;
    const clipY1 = (screenY1 / this.displayHeight) * 2 - 1; // Top of bar
    const clipY2 = (screenY2 / this.displayHeight) * 2 - 1; // Bottom of bar

    // Write position data (6 vertices for 2 triangles)
    // Triangle 1: top-left, top-right, bottom-right
    this.positionData[positionOffset] = clipX1;
    this.positionData[positionOffset + 1] = clipY1;
    this.positionData[positionOffset + 2] = clipX2;
    this.positionData[positionOffset + 3] = clipY1;
    this.positionData[positionOffset + 4] = clipX2;
    this.positionData[positionOffset + 5] = clipY2;

    // Triangle 2: top-left, bottom-right, bottom-left
    this.positionData[positionOffset + 6] = clipX1;
    this.positionData[positionOffset + 7] = clipY1;
    this.positionData[positionOffset + 8] = clipX2;
    this.positionData[positionOffset + 9] = clipY2;
    this.positionData[positionOffset + 10] = clipX1;
    this.positionData[positionOffset + 11] = clipY2;

    // Convert 0xRRGGBB + alpha to 0xAABBGGRR (ABGR for little-endian systems)
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const a = Math.round(alpha * 255) & 0xff;
    const packedColor = (a << 24) | (b << 16) | (g << 8) | r;

    // Write color data (same color for all 6 vertices)
    this.colorData[colorOffset] = packedColor;
    this.colorData[colorOffset + 1] = packedColor;
    this.colorData[colorOffset + 2] = packedColor;
    this.colorData[colorOffset + 3] = packedColor;
    this.colorData[colorOffset + 4] = packedColor;
    this.colorData[colorOffset + 5] = packedColor;
  }

  /**
   * Set the number of bars to draw and update GPU buffers.
   *
   * @param barCount - Number of bars to draw
   */
  public setDrawCount(barCount: number): void {
    const vertexCount = barCount * VERTICES_PER_BAR;

    if (vertexCount > 0) {
      this.positionBuffer.data = this.positionData.subarray(0, vertexCount * FLOATS_PER_POSITION);
      this.colorBuffer.data = this.colorData.subarray(0, vertexCount);
    } else {
      this.positionBuffer.data = new Float32Array(0);
      this.colorBuffer.data = new Uint32Array(0);
    }

    this.positionBuffer.update();
    this.colorBuffer.update();
  }

  /**
   * Get the PixiJS Geometry instance for use with Mesh.
   */
  public getGeometry(): Geometry {
    return this.geometry;
  }

  /**
   * Clean up resources.
   */
  public destroy(): void {
    this.geometry.destroy();
  }
}
