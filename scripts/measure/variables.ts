/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the Variables section: one log-wide walk, a frame snapshot, then the
 * busiest merged row's comparison.
 */
import type { ApexLog, LogEvent } from 'apex-log-parser';

import { aggregateVariablesFor } from '../../log-viewer/src/core/log/aggregateVariables.js';
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

  // A merged row is answered by comparing its calls, so the worst row there is
  // sets what the section costs on a selection the reader will actually make.
  const busiest = busiestSignature(frames);
  if (!busiest.length) {
    return;
  }
  line('busiest signature', `${busiest[0]!.text} — ${busiest.length.toLocaleString()} calls`);
  const compared = busiest.map((frame) => frame.eventIndex);
  const spread = await time(`aggregate over ${compared.length.toLocaleString()} calls`, () =>
    aggregateVariablesFor(store, compared, index, { yieldSlice }),
  );
  line(
    'spread',
    `${spread?.locals.length ?? 0} locals, ${spread?.fields.length ?? 0} fields, ` +
      `${spread?.locals.filter((row) => row.values.length > 1).length ?? 0} varied`,
  );
  await time('aggregate (again)', () =>
    aggregateVariablesFor(store, compared, index, { yieldSlice }),
  );
}

/** The frames of the signature the log holds most calls of: the merged row whose
 *  comparison costs the most. */
function busiestSignature(frames: readonly LogEvent[]): LogEvent[] {
  const byText = new Map<string, LogEvent[]>();
  for (const frame of frames) {
    const held = byText.get(frame.text);
    if (held) {
      held.push(frame);
    } else {
      byText.set(frame.text, [frame]);
    }
  }
  let busiest: LogEvent[] = [];
  for (const held of byText.values()) {
    if (held.length > busiest.length) {
      busiest = held;
    }
  }
  return busiest;
}
