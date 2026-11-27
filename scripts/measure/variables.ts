/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Times the Variables section: one log-wide walk, a frame snapshot, then the
 * busiest merged row's comparison.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { aggregateVariablesFor } from '../../log-viewer/src/core/log/aggregateVariables.js';
import { frameVariablesFor, variableIndex } from '../../log-viewer/src/core/log/frameVariables.js';
import { logStoreFor, setCurrentLog } from '../../log-viewer/src/core/log/LogStore.js';
import { signaturesOf } from '../../log-viewer/src/core/log/signatures.js';
import { line, time, yieldSlice } from './harness.js';

/** Frames timed, spread across the log, so the figure is not one warm subtree. */
const SAMPLED_FRAMES = 100;

export async function measureVariables(log: ApexLog): Promise<void> {
  const store = setCurrentLog(logStoreFor(log));
  // Built first so the times below are the variable index's own.
  await store.logIndex({ yieldSlice });

  const index = await time('variable index (first open)', () => store.derive(variableIndex));
  await time('variable index (again)', () => store.derive(variableIndex));
  line('statics', `sawAnyWrite=${index.sawAnyWrite}`);

  const { isFrame, parent } = log.columns;
  const frames: number[] = [];
  const childCount = new Int32Array(log.eventCount + 1);
  for (let id = 1; id <= log.eventCount; id++) {
    if (isFrame[id]) {
      frames.push(id);
    }
    const above = parent[id]!;
    if (above > 0) {
      childCount[above]!++;
    }
  }
  const step = Math.max(1, Math.floor(frames.length / SAMPLED_FRAMES));
  const sampled = frames.filter((_, at) => at % step === 0).slice(0, SAMPLED_FRAMES);
  // The addresses come from the snapshots this times, so the sampled frames are
  // read once rather than again for the fields below.
  const objects = new Set<string>();
  await time(`${sampled.length} frame snapshots`, () => {
    for (const frame of sampled) {
      for (const row of frameVariablesFor(store, frame)?.locals ?? []) {
        if (row.objectAddress) {
          objects.add(row.objectAddress);
        }
      }
    }
  });

  // The average hides the frame holding hundreds of thousands of its own lines,
  // and that is the frame a snapshot has to read back through.
  const worst = frames.reduce<number | null>(
    (held, frame) => (held === null || childCount[frame]! > childCount[held]! ? frame : held),
    null,
  );
  if (worst === null) {
    return;
  }
  line('worst frame', `${childCount[worst]!.toLocaleString()} children`);

  // Timed before anything else reads the frame, so this is a first ask. Only the
  // lines before the selected one are read, so selecting the first line inside the
  // frame must not cost what reading the whole frame does.
  if (childCount[worst]! > 0) {
    await time('worst frame, first line', () => frameVariablesFor(store, worst + 1));
  }
  const shape = frameVariablesFor(store, worst);
  line(
    'worst frame scope',
    `${shape?.locals.length ?? 0} locals, ${shape?.fields.length ?? 0} fields`,
  );
  await time('worst frame snapshot', () => frameVariablesFor(store, worst));

  // Opening an object row reads that object's fields back, so this is what a row
  // costs once the scope is on screen.
  const view = index.viewAt(Number.MAX_SAFE_INTEGER);
  await time(`fields on ${objects.size} objects`, () => {
    for (const address of objects) {
      view.fields(address);
    }
  });

  // A merged row is answered by comparing its calls, so the worst row there is
  // sets what the section costs on a selection the reader will actually make.
  const busiest = busiestSignature(log, frames);
  if (!busiest.frames.length) {
    return;
  }
  line('busiest signature', `${busiest.text} — ${busiest.frames.length.toLocaleString()} calls`);
  const spread = await time(`aggregate over ${busiest.frames.length.toLocaleString()} calls`, () =>
    aggregateVariablesFor(store, busiest.frames, { yieldSlice }),
  );
  line(
    'spread',
    `${spread?.locals.length ?? 0} locals, ${spread?.fields.length ?? 0} fields, ` +
      `${spread?.locals.filter((row) => row.values.length > 1).length ?? 0} varied`,
  );
  await time('aggregate (again)', () =>
    aggregateVariablesFor(store, busiest.frames, { yieldSlice }),
  );
}

/** The frames of the signature the log holds most calls of: the merged row whose
 *  comparison costs the most. Keyed by signature, which is what the grids bucket
 *  by, so the row this times is one a reader can actually select. */
function busiestSignature(
  log: ApexLog,
  frames: readonly number[],
): { text: string; frames: number[] } {
  const signatures = signaturesOf(log);
  const bySignature = new Map<number, number[]>();
  for (const frame of frames) {
    const signature = signatures.of(frame);
    const held = bySignature.get(signature);
    if (held) {
      held.push(frame);
    } else {
      bySignature.set(signature, [frame]);
    }
  }
  let busiest: [number, number[]] = [-1, []];
  for (const entry of bySignature) {
    if (entry[1].length > busiest[1].length) {
      busiest = entry;
    }
  }
  return { text: busiest[0] < 0 ? '' : signatures.text(busiest[0]), frames: busiest[1] };
}
