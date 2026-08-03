/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { DetailSource } from '../core/events/EventBus.js';

/**
 * Per-source copy for the inspector's empty state, rendered by `DetailDock`
 * whenever `buildDetailSections` returns no sections. Kept in a leaf module so
 * consumers (and their tests) can reach the real copy without pulling in the
 * section builders' web components.
 */
const EMPTY_TEXT: Record<DetailSource, string> = {
  timeline: 'Select a frame on the timeline to inspect it.',
  calltree: 'Select a frame in the call tree to inspect it.',
  analysis: 'Select a row in the analysis grid to inspect it.',
  database: 'Select a SOQL, DML or SOSL row to inspect it.',
};

/**
 * Empty-state copy for the given source. `source` is `undefined` until a tab id
 * resolves, so that case falls back to generic wording.
 */
export function emptyTextFor(source: DetailSource | undefined): string {
  return source ? EMPTY_TEXT[source] : 'Select a row to inspect it.';
}
