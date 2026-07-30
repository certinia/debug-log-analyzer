/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html } from 'lit';

import type { DetailSelection, DetailSource } from '../core/events/EventBus.js';
import { buildDatabaseSections } from '../features/database/components/databaseSections.js';
import type { PaneSection } from './PaneView.js';

// web components
import './CallStackDetail.js';
import './CallTreeDetail.js';
import './EventVitals.js';

/**
 * Per-source copy for the inspector's empty state (`LogInspector`'s
 * `emptyText`, rendered by `DetailDock` whenever {@link buildDetailSections}
 * returns `[]`). This is the single source of truth for that copy — keep it
 * here rather than duplicating strings at the call site.
 */
const EMPTY_TEXT: Record<DetailSource, string> = {
  timeline: 'Select a frame on the timeline to inspect it.',
  calltree: 'Select a frame in the call tree to inspect it.',
  analysis: 'Select a row in the analysis grid to inspect it.',
  database: 'Select a SOQL, DML or SOSL row to inspect it.',
};

/** Empty-state copy for the given source, or a generic fallback if the active tab has none. */
export function emptyTextFor(source: DetailSource | undefined): string {
  return source ? EMPTY_TEXT[source] : 'Select a row to inspect it.';
}

/**
 * Build the inspector's sections for a selection from any tab. Every source gets
 * the same shared trio — Details, Call stack, Call tree — scoped to the
 * selection; the Database view keeps its richer set (Vitals + SOQL issues) via
 * {@link buildDatabaseSections}.
 *
 * Precedence rule (binding on future scoping inputs, e.g. a timeline
 * time-range selection): an explicit row/frame `selection` always wins. A
 * range or other ambient scope only applies when `selection` is `null` — it
 * must be layered into the `!selection` branch below, not made to override an
 * explicit selection.
 */
export async function buildDetailSections(
  source: DetailSource,
  selection: DetailSelection | null,
): Promise<PaneSection[]> {
  // Nothing explicitly selected: no sections yet, so the inspector shows its
  // source-specific empty text (see `emptyTextFor`). A future range-scoped
  // fallback belongs in this branch, after checking for one — never above it.
  if (!selection) {
    return [];
  }

  // The Database grids resolve statement-specific vitals and SOQL lint issues.
  if (source === 'database' && selection.kind === 'event' && selection.type) {
    return buildDatabaseSections({ eventIndex: selection.eventIndex, type: selection.type });
  }

  const isAggregate = selection.kind === 'aggregate';
  // An aggregate scopes to all its occurrences; a single frame to itself.
  const eventIndex = isAggregate ? (selection.instances[0] ?? -1) : selection.eventIndex;
  const instances = isAggregate ? selection.instances : null;
  const label = isAggregate ? selection.label : '';

  return [
    {
      id: 'vitals',
      title: 'Details',
      weight: 3,
      content: html`<event-vitals
        eventIndex=${eventIndex}
        .instances=${instances}
        label=${label}
      ></event-vitals>`,
    },
    {
      id: 'callstack',
      title: 'Call stack',
      weight: 3,
      content: html`<call-stack-detail eventIndex=${eventIndex}></call-stack-detail>`,
    },
    {
      id: 'calltree',
      title: 'Call tree',
      weight: 4,
      content: html`<call-tree-detail
        eventIndex=${eventIndex}
        .instances=${instances}
      ></call-tree-detail>`,
    },
  ];
}
