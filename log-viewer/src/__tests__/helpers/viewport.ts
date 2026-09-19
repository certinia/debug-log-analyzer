/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ViewportState } from '../../features/timeline/types/flamechart.types.js';

/**
 * A viewport a test can vary one field of. The canvas a renderer measures against
 * is stated here once, so a case that does depend on its size says so by passing it.
 */
export function makeViewport(over: Partial<ViewportState> = {}): ViewportState {
  return {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    displayWidth: 1000,
    displayHeight: 600,
    ...over,
  };
}
