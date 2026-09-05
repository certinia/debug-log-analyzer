/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the inspector's range scope: one read of the log, then a window per frame.
 */
import type { ApexLog } from 'apex-log-parser';

import { windowIndexFor } from '../../log-viewer/src/core/log/windowStats.js';
import { time } from './harness.js';

// The build slices itself against this; resolving at once measures the work
// rather than the frames it would hand back on screen.
const yieldSlice = () => Promise.resolve();

/** Windows a reader zooms to, as a share of the log. */
const WINDOWS = [
  ['narrow (8%)', 0.08],
  ['half (50%)', 0.5],
  ['wide (90%)', 0.9],
  ['whole log', 1],
] as const;

/** Frames in a drag: the figure that decides whether the summary can follow it. */
const DRAG_FRAMES = 60;

export async function measureWindow(log: ApexLog): Promise<void> {
  const logStart = log.timestamp;
  const logSpan = (log.exitStamp ?? logStart) - logStart;
  const at = (from: number, share: number) => ({
    start: logStart + logSpan * from,
    end: logStart + logSpan * (from + share),
  });

  // One read of the log, then every window is answered from it. The heap column
  // is what the index costs.
  const index = await time('windowIndex build', () => windowIndexFor(log, { yieldSlice }));

  for (const [label, share] of WINDOWS) {
    const window = at(share === 1 ? 0 : 0.05, share);
    const stats = await time(`statsFor ${label}`, () => index.statsFor(window));
    const self = [...stats.selfByCategory.values()].reduce((sum, held) => sum + held, 0);
    console.log(
      `  ${stats.selfByCategory.size} categories, ${stats.selfByNamespace.size} namespaces, ` +
        `${Math.round(self / 1_000_000)}ms self, ${stats.counts.soqlCount} SOQL`,
    );
  }

  // A drag: a window per frame, none of them the same.
  await time(`statsFor x${DRAG_FRAMES} (a drag)`, () => {
    for (let frame = 0; frame < DRAG_FRAMES; frame++) {
      index.statsFor(at(frame / (DRAG_FRAMES * 4), 0.25));
    }
  });
}
