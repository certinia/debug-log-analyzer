/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { Text } from 'pixi.js';

import type { TickInterval, TickLabelResult, TimeAxisLabelStrategy } from './MeshAxisRenderer.js';
import { NS_PER_MS, formatMilliseconds } from './timeAxisConstants.js';

/**
 * Elapsed-time label strategy for the time axis.
 * Formats labels as elapsed time (e.g., "1 s", "500 ms", "1.234 ms").
 */
export class ElapsedTimeAxisRenderer implements TimeAxisLabelStrategy {
  adjustTickInterval(interval: TickInterval): TickInterval {
    return interval;
  }

  beginFrame(): void {
    // No per-frame state needed for elapsed time
  }

  renderTickLabel(
    time: number,
    screenSpaceX: number,
    getOrCreateLabel: (text: string) => Text,
  ): TickLabelResult | null {
    const timeMs = time / NS_PER_MS;
    const labelText = formatMilliseconds(timeMs);
    if (!labelText) {
      return null;
    }

    const label = getOrCreateLabel(labelText);
    label.x = screenSpaceX - 3;
    label.y = 5;
    label.anchor.set(1, 0);

    return { label, isAnchor: false };
  }

  endFrame(): void {
    // No post-frame work for elapsed time
  }

  refreshColors(_textColor: string): void {
    // No owned resources to update
  }

  destroy(): void {
    // No owned resources to clean up
  }
}
