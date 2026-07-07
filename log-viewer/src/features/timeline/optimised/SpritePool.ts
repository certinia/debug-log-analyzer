/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * SpritePool
 *
 * Object pool for PixiJS Sprites using a shared 1x1 white texture.
 * Provides efficient rectangle rendering by:
 * - Reusing sprite instances to avoid GC overhead
 * - Using a single shared texture for automatic GPU batching
 * - Setting color via sprite.tint (efficient uniform update)
 *
 * Usage:
 *   const pool = new SpritePool(container, sharedTexture);
 *   // Each frame:
 *   pool.releaseAll();
 *   for (const rect of rectangles) {
 *     const sprite = pool.acquire();
 *     sprite.position.set(rect.x, rect.y);
 *     sprite.width = rect.width;
 *     sprite.height = rect.height;
 *     sprite.tint = rect.color;
 *   }
 *   // On cleanup:
 *   pool.destroy();
 *
 * Performance characteristics:
 * - Zero allocations after warmup (sprites reused via visibility toggle)
 * - Single draw call for all sprites (automatic batching with shared texture)
 * - O(1) acquire, O(n) releaseAll where n = active sprites
 */

import { Container, Sprite, Texture } from 'pixi.js';

/**
 * Get the shared 1x1 white texture.
 * Uses PixiJS's built-in Texture.WHITE for maximum compatibility and batching.
 *
 * @returns The shared white texture
 */
export function getSharedWhiteTexture(): Texture {
  return Texture.WHITE;
}

/**
 * Destroy the shared white texture.
 * No-op since we use PixiJS's built-in Texture.WHITE which should not be destroyed.
 */
export function destroySharedWhiteTexture(): void {
  // No-op: Texture.WHITE is a built-in texture that should not be destroyed
}

/**
 * SpritePool - Efficient sprite reuse for rectangle rendering.
 *
 * Manages a pool of sprites that share a common texture.
 * Sprites are acquired for rendering and released back to the pool each frame.
 */
export class SpritePool {
  /** Array of all sprites (both active and inactive) */
  private pool: Sprite[] = [];

  /** Number of currently active (visible) sprites */
  private activeCount = 0;

  /** The shared texture used by all sprites */
  private texture: Texture;

  /** Container that holds all sprites */
  private container: Container;

  /**
   * Create a new SpritePool.
   *
   * @param parentContainer - The container to add sprites to
   * @param texture - Optional texture to use (defaults to shared white texture)
   */
  constructor(parentContainer: Container, texture?: Texture) {
    this.texture = texture ?? getSharedWhiteTexture();
    this.container = new Container();
    this.container.label = 'SpritePool';
    parentContainer.addChild(this.container);
  }

  /**
   * Acquire a sprite from the pool.
   * Returns an existing sprite if available, otherwise creates a new one.
   * The returned sprite is visible and ready for configuration.
   *
   * @returns A sprite ready for use
   */
  public acquire(): Sprite {
    let sprite: Sprite;

    if (this.activeCount < this.pool.length) {
      // Reuse existing sprite from pool
      sprite = this.pool[this.activeCount]!;
      sprite.visible = true;
    } else {
      // Create new sprite and add to pool
      sprite = new Sprite(this.texture);
      this.pool.push(sprite);
      this.container.addChild(sprite);
    }

    this.activeCount++;
    return sprite;
  }

  /**
   * Release all sprites back to the pool.
   * Hides all active sprites for reuse in the next frame.
   * Call this at the start of each render cycle.
   */
  public releaseAll(): void {
    for (let i = 0; i < this.activeCount; i++) {
      this.pool[i]!.visible = false;
    }
    this.activeCount = 0;
  }

  /**
   * Get the number of currently active sprites.
   *
   * @returns Number of sprites currently in use
   */
  public getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Get the total pool size (active + inactive sprites).
   *
   * @returns Total number of sprites in pool
   */
  public getPoolSize(): number {
    return this.pool.length;
  }

  /**
   * Clean up all sprites and remove from container.
   * Does NOT destroy the shared texture (managed separately).
   * Call this when the renderer is destroyed.
   */
  public destroy(): void {
    for (const sprite of this.pool) {
      sprite.destroy();
    }
    this.pool = [];
    this.activeCount = 0;
    this.container.destroy();
  }
}
