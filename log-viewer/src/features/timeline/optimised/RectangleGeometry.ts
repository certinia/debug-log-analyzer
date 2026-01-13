/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * RectangleGeometry
 *
 * Manages PixiJS Geometry with efficient buffer updates for rectangle rendering.
 * Uses NON-INDEXED geometry (6 vertices per quad) to avoid index buffer compatibility
 * issues with PixiJS 8's custom shader rendering.
 *
 * Performance optimizations:
 * - Grow-only buffer strategy (avoids GC from reallocations)
 * - Direct typed array access for fast buffer filling
 * - Single geometry instance reused each frame
 * - Clip-space coordinates (no shader uniforms needed)
 *
 * Buffer layout per rectangle (6 vertices forming 2 triangles):
 *   v0 (x, y)          v1 (x+w, y)
 *     ┌─────────────────┐
 *     │ \               │
 *     │   \   tri 1     │
 *     │     \           │
 *     │       \         │
 *     │  tri 2  \       │
 *     │           \     │
 *     └─────────────────┘
 *   v2 (x, y+h)        v3 (x+w, y+h)
 *
 * Triangle 1: v0, v1, v3 (top-left, top-right, bottom-right)
 * Triangle 2: v0, v3, v2 (top-left, bottom-right, bottom-left)
 */

import { Buffer, Geometry } from 'pixi.js';

/** Initial capacity in number of rectangles */
const INITIAL_CAPACITY = 1000;

/** Growth factor when capacity is exceeded */
const GROWTH_FACTOR = 2;

/** Vertices per rectangle (6 for 2 triangles, non-indexed) */
const VERTICES_PER_RECT = 6;

/** Floats per vertex for position (x, y) */
const FLOATS_PER_POSITION = 2;

/**
 * Viewport transform parameters for converting world to clip space.
 */
export interface ViewportTransform {
  /** Horizontal offset in world coordinates */
  offsetX: number;
  /** Vertical offset in world coordinates */
  offsetY: number;
  /** Display width in pixels */
  displayWidth: number;
  /** Display height in pixels */
  displayHeight: number;
}

/**
 * RectangleGeometry - Efficient geometry management for rectangle rendering.
 *
 * Uses non-indexed geometry (6 vertices per quad) for maximum compatibility
 * with PixiJS 8's custom shader rendering pipeline.
 *
 * Provides methods to:
 * - Ensure buffer capacity for a given number of rectangles
 * - Write rectangle data (position + color) to buffers in clip space
 * - Set the draw count for partial rendering
 * - Get the underlying PixiJS Geometry for use with Mesh
 */
export class RectangleGeometry {
  /** PixiJS Geometry instance */
  private geometry: Geometry;

  /** PixiJS Buffer for positions */
  private positionBuffer: Buffer;

  /** PixiJS Buffer for colors */
  private colorBuffer: Buffer;

  /** Typed array for position data (2 floats per vertex, 6 vertices per rect) */
  private positionData: Float32Array;

  /** Typed array for color data (1 uint32 per vertex, 6 vertices per rect) */
  private colorData: Uint32Array;

  /** Current capacity in number of rectangles */
  private capacity: number = 0;

  /** Current rectangle count being rendered */
  private currentCount: number = 0;

  /**
   * Create a new RectangleGeometry.
   *
   * Allocates initial buffers and creates the PixiJS Geometry.
   */
  constructor() {
    // Initialize with default capacity (6 vertices per rect for non-indexed)
    this.positionData = new Float32Array(
      INITIAL_CAPACITY * VERTICES_PER_RECT * FLOATS_PER_POSITION,
    );
    this.colorData = new Uint32Array(INITIAL_CAPACITY * VERTICES_PER_RECT);
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
    // Attribute names must match shader: aPosition, aColor
    this.geometry = new Geometry({
      attributes: {
        aPosition: {
          buffer: this.positionBuffer,
          format: 'float32x2',
          stride: FLOATS_PER_POSITION * 4, // 2 floats * 4 bytes
          offset: 0,
        },
        aColor: {
          buffer: this.colorBuffer,
          format: 'unorm8x4', // 4 bytes normalized to 0-1 range
          stride: 4, // 1 uint32 = 4 bytes
          offset: 0,
        },
      },
      // No indexBuffer - using triangle-list with 6 vertices per quad
    });
  }

  /**
   * Ensure buffers have capacity for at least the given number of rectangles.
   *
   * Uses grow-only strategy: buffers only grow, never shrink.
   * This avoids repeated reallocations and GC pressure.
   *
   * @param rectCount - Required number of rectangles
   */
  public ensureCapacity(rectCount: number): void {
    if (rectCount <= this.capacity) {
      return;
    }

    // Calculate new capacity (at least 2x current, or requested amount)
    let newCapacity = this.capacity * GROWTH_FACTOR;
    while (newCapacity < rectCount) {
      newCapacity *= GROWTH_FACTOR;
    }

    // Allocate new typed arrays (6 vertices per rect)
    const newPositionData = new Float32Array(newCapacity * VERTICES_PER_RECT * FLOATS_PER_POSITION);
    const newColorData = new Uint32Array(newCapacity * VERTICES_PER_RECT);

    // Copy existing data (if any)
    newPositionData.set(this.positionData);
    newColorData.set(this.colorData);

    // Update references
    this.positionData = newPositionData;
    this.colorData = newColorData;
    this.capacity = newCapacity;

    // Update PixiJS buffers with new data
    this.positionBuffer.data = this.positionData;
    this.colorBuffer.data = this.colorData;
  }

  /**
   * Write a rectangle to the buffers at the given index.
   *
   * Converts world coordinates to clip space using the provided viewport transform.
   * Positions are written as 6 vertices forming 2 triangles.
   * Color is written as packed RGBA uint32 for all 6 vertices.
   *
   * @param rectIndex - Rectangle index (0-based)
   * @param worldX - Left edge X in world coordinates
   * @param worldY - Top edge Y in world coordinates
   * @param worldWidth - Rectangle width in world coordinates
   * @param worldHeight - Rectangle height in world coordinates
   * @param color - PixiJS color (0xRRGGBB), will be converted to RGBA
   * @param viewport - Viewport transform for coordinate conversion
   */
  public writeRectangle(
    rectIndex: number,
    worldX: number,
    worldY: number,
    worldWidth: number,
    worldHeight: number,
    color: number,
    viewport: ViewportTransform,
  ): void {
    // Calculate buffer offsets (6 vertices per rect)
    const positionOffset = rectIndex * VERTICES_PER_RECT * FLOATS_PER_POSITION;
    const colorOffset = rectIndex * VERTICES_PER_RECT;

    // Convert world coordinates to screen coordinates
    // The worldContainer normally has:
    //   position: (-offsetX, displayHeight - offsetY)
    //   scale: (1, -1)
    // So screen position = containerPosition + worldPosition * scale
    //   screenX = -offsetX + worldX * 1 = worldX - offsetX
    //   screenY = (displayHeight - offsetY) + worldY * (-1) = displayHeight - offsetY - worldY
    const screenX1 = worldX - viewport.offsetX;
    const screenX2 = worldX + worldWidth - viewport.offsetX;
    const screenY1 = viewport.displayHeight - viewport.offsetY - worldY;
    const screenY2 = viewport.displayHeight - viewport.offsetY - (worldY + worldHeight);

    // Convert screen coordinates to clip space (-1 to 1)
    // Clip space: X from -1 (left) to +1 (right), Y from +1 (top) to -1 (bottom)
    // Screen space: X from 0 (left) to displayWidth (right), Y from 0 (top) to displayHeight (bottom)
    const clipX1 = (screenX1 / viewport.displayWidth) * 2 - 1;
    const clipX2 = (screenX2 / viewport.displayWidth) * 2 - 1;
    // Note: Y is inverted - screenY=0 maps to clipY=+1, screenY=displayHeight maps to clipY=-1
    const clipY1 = 1 - (screenY1 / viewport.displayHeight) * 2;
    const clipY2 = 1 - (screenY2 / viewport.displayHeight) * 2;

    // Write position data (6 vertices for 2 triangles)
    // In clip space: Y increases upward, so clipY2 is top, clipY1 is bottom
    //
    // Triangle 1: top-left, top-right, bottom-right
    // v0: top-left
    this.positionData[positionOffset] = clipX1;
    this.positionData[positionOffset + 1] = clipY2;
    // v1: top-right
    this.positionData[positionOffset + 2] = clipX2;
    this.positionData[positionOffset + 3] = clipY2;
    // v2: bottom-right
    this.positionData[positionOffset + 4] = clipX2;
    this.positionData[positionOffset + 5] = clipY1;

    // Triangle 2: top-left, bottom-right, bottom-left
    // v3: top-left (same as v0)
    this.positionData[positionOffset + 6] = clipX1;
    this.positionData[positionOffset + 7] = clipY2;
    // v4: bottom-right (same as v2)
    this.positionData[positionOffset + 8] = clipX2;
    this.positionData[positionOffset + 9] = clipY1;
    // v5: bottom-left
    this.positionData[positionOffset + 10] = clipX1;
    this.positionData[positionOffset + 11] = clipY1;

    // Convert 0xRRGGBB to 0xAABBGGRR (ABGR for little-endian systems)
    // Alpha is always 255 (fully opaque) since colors are pre-blended
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    const packedColor = 0xff000000 | (b << 16) | (g << 8) | r; // ABGR format

    // Write color data (same color for all 6 vertices)
    this.colorData[colorOffset] = packedColor;
    this.colorData[colorOffset + 1] = packedColor;
    this.colorData[colorOffset + 2] = packedColor;
    this.colorData[colorOffset + 3] = packedColor;
    this.colorData[colorOffset + 4] = packedColor;
    this.colorData[colorOffset + 5] = packedColor;
  }

  /**
   * Set the number of rectangles to draw.
   *
   * Updates the vertex count for non-indexed rendering.
   *
   * @param rectCount - Number of rectangles to draw
   */
  public setDrawCount(rectCount: number): void {
    this.currentCount = rectCount;

    // Calculate vertex count (6 vertices per rectangle)
    const vertexCount = rectCount * VERTICES_PER_RECT;

    // Update buffers with only the used portion
    if (vertexCount > 0) {
      this.positionBuffer.data = this.positionData.subarray(0, vertexCount * FLOATS_PER_POSITION);
      this.colorBuffer.data = this.colorData.subarray(0, vertexCount);
    } else {
      // Empty arrays for zero draw count
      this.positionBuffer.data = new Float32Array(0);
      this.colorBuffer.data = new Uint32Array(0);
    }

    this.positionBuffer.update();
    this.colorBuffer.update();
  }

  /**
   * Get the current rectangle count.
   *
   * @returns Number of rectangles currently set for rendering
   */
  public getDrawCount(): number {
    return this.currentCount;
  }

  /**
   * Get the PixiJS Geometry instance for use with Mesh.
   *
   * @returns The geometry instance
   */
  public getGeometry(): Geometry {
    return this.geometry;
  }

  /**
   * Clean up resources.
   *
   * Destroys the geometry and all buffers.
   */
  public destroy(): void {
    this.geometry.destroy();
  }
}
