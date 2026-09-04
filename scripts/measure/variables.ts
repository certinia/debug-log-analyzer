/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the Variables section: one log-wide walk, then a frame snapshot.
 */
import type { ApexLog } from 'apex-log-parser';

import {
  frameVariablesFor,
  variableIndexFor,
} from '../../log-viewer/src/core/log/frameVariables.js';
import { logStoreFor, setCurrentLog } from '../../log-viewer/src/core/log/LogStore.js';
import { line, time } from './harness.js';

// The walk slices itself against this; resolving at once measures the work
// rather than the frames it would leave to the next paint.
const yieldSlice = () => Promise.resolve();

/** Frames timed, spread across the log, so the figure is not one warm subtree. */
const SAMPLED_FRAMES = 100;

export async function measureVariables(log: ApexLog): Promise<void> {
  setCurrentLog(log);

  const index = await time('variableIndexFor (first open)', () =>
    variableIndexFor(log, { yieldSlice }),
  );
  await time('variableIndexFor (again)', () => variableIndexFor(log, { yieldSlice }));
  line(
    'statics',
    `sawAnyWrite=${index.sawAnyWrite}, capped=${index.capped}, ` +
      `${index.at(Number.MAX_SAFE_INTEGER).length} classes`,
  );

  const store = logStoreFor(log);
  const frames = log.eventsById.filter((event) => event.isParent);
  const step = Math.max(1, Math.floor(frames.length / SAMPLED_FRAMES));
  const sampled = frames.filter((_, at) => at % step === 0).slice(0, SAMPLED_FRAMES);
  // The addresses come from the snapshots this times, so the sampled frames are
  // read once rather than again for the fields below.
  const objects = new Set<string>();
  await time(`${sampled.length} frame snapshots`, () => {
    for (const frame of sampled) {
      for (const row of frameVariablesFor(store, frame.eventIndex, index)?.locals ?? []) {
        if (row.objectAddress) {
          objects.add(row.objectAddress);
        }
      }
    }
  });

  // The average hides the frame holding hundreds of thousands of its own lines,
  // and that is the frame a snapshot has to read back through.
  const worst = frames.length
    ? frames.reduce((held, frame) => (frame.children.length > held.children.length ? frame : held))
    : null;
  if (!worst) {
    return;
  }
  const shape = frameVariablesFor(store, worst.eventIndex, index);
  line(
    'worst frame',
    `${worst.children.length.toLocaleString()} children, ` +
      `${shape?.locals.length ?? 0} locals, ${shape?.fields.length ?? 0} fields`,
  );
  await time('worst frame snapshot', () => frameVariablesFor(store, worst.eventIndex, index));

  // Opening an object row reads that object's fields back, so this is what a row
  // costs once the scope is on screen.
  await time(`fieldsAt on ${objects.size} objects`, () => {
    for (const address of objects) {
      index.fieldsAt(address, Number.MAX_SAFE_INTEGER);
    }
  });
}
