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
 * Build the side bar's sections for a selection from any tab. Every source gets
 * the same shared trio — Details, Call stack, Call tree — scoped to the
 * selection; the Database view keeps its richer set (Vitals + SOQL issues) via
 * {@link buildDatabaseSections}.
 */
export async function buildDetailSections(
  source: DetailSource,
  selection: DetailSelection,
  collapsed: Record<string, boolean> = {},
): Promise<PaneSection[]> {
  // The Database grids resolve statement-specific vitals and SOQL lint issues.
  if (source === 'database' && selection.kind === 'event' && selection.type) {
    return buildDatabaseSections(
      { eventIndex: selection.eventIndex, type: selection.type },
      collapsed,
    );
  }

  // Persisted collapsed state wins over the per-section default.
  const isCollapsed = (id: string, fallback = false) => collapsed[id] ?? fallback;
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
      collapsed: isCollapsed('vitals'),
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
      collapsed: isCollapsed('callstack'),
      content: html`<call-stack-detail eventIndex=${eventIndex}></call-stack-detail>`,
    },
    {
      id: 'calltree',
      title: 'Call tree',
      weight: 4,
      collapsed: isCollapsed('calltree'),
      content: html`<call-tree-detail
        eventIndex=${eventIndex}
        .instances=${instances}
      ></call-tree-detail>`,
    },
  ];
}
