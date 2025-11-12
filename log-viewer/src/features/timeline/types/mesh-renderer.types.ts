/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Type definitions for Mesh-Based Timeline Rendering.
 *
 * This file defines the contracts for GPU-accelerated vertex buffer rendering
 * of timeline events using PixiJS Mesh API.
 *
 * Design principles:
 * - Type safety: Strict TypeScript types for all GPU data structures
 * - Performance: Typed arrays for efficient memory layout
 * - Compatibility: Works with existing LogEvent and ViewportState types
 */

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import type { TimelineEventIndex } from '../services/TimelineEventIndex.js';
import type { ViewportState } from './timeline.types.js';

// ============================================================================
// RENDERER INTERFACE
// ============================================================================

/**
 * Configuration options for mesh renderer.
 */
export interface MeshRendererConfig {
  /** PixiJS container to add meshes to */
  container: unknown; // PIXI.Container (avoid importing PixiJS here)

  /** Event categories with colors */
  batches: Map<string, { color: number }>;

  /** All events to render */
  events: LogEvent[];

  viewport: ViewportState;
  index: TimelineEventIndex;
}

/**
 * Main mesh renderer interface.
 * Replaces Graphics-based EventBatchRenderer.
 */
export interface MeshRenderer {
  /** Render visible events for current viewport */
  render(viewport: ViewportState): void;

  /** Clean up GPU resources */
  destroy(): void;
}
