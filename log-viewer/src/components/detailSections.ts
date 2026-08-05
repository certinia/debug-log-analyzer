/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html } from 'lit';

import type { DetailSelection, DetailSource } from '../core/events/EventBus.js';
import { buildDatabaseSections } from '../features/database/components/databaseSections.js';
import type { PaneSection } from './PaneView.js';

// web components
import '../features/analysis/components/LogDiagnosticsView.js';
import './CallStackDetail.js';
import './CallTreeDetail.js';
import './CategoryTimeBar.js';
import './EventVitals.js';
import './GovernorTrends.js';
import './LogOverview.js';

/**
 * Build the inspector's sections for a selection from any tab. Every source gets
 * the same shared trio — Details, Call stack, Call tree — scoped to the
 * selection; the Database view keeps its richer set (Vitals + SOQL issues) via
 * {@link buildDatabaseSections}.
 *
 * With nothing selected every source gets the whole-log analogue of what its tab
 * does: the shared **Log overview**, plus the sections that tab can answer at log
 * scope. Analysis adds **Findings**; the Timeline adds its charts and the
 * whole-log call tree.
 *
 * Precedence rule, binding on future scoping inputs such as a timeline time
 * range: an explicit row/frame `selection` always wins. A range or other
 * ambient scope only applies when `selection` is `null`, so it belongs inside
 * the `!selection` branch — never above it.
 */
export async function buildDetailSections(
  source: DetailSource,
  selection: DetailSelection | null,
): Promise<PaneSection[]> {
  // Nothing selected: the whole log is the scope. `DetailDock`'s own empty
  // state still covers the moment before a tab id resolves.
  if (!selection) {
    const sections: PaneSection[] = [
      {
        id: 'overview',
        title: 'Log overview',
        weight: 1,
        content: html`<log-overview></log-overview>`,
      },
    ];
    if (source === 'analysis') {
      sections.push({
        id: 'findings',
        title: 'Findings',
        weight: 3,
        content: html`<log-diagnostics></log-diagnostics>`,
      });
    }
    if (source === 'timeline') {
      // The Timeline's whole-log analogue: where the time went (by category and
      // by frame) and how governor consumption built up across the log.
      sections.push(
        {
          id: 'category-time',
          title: 'Time by category',
          weight: 1,
          content: html`<category-time-bar></category-time-bar>`,
        },
        {
          id: 'governor-trends',
          title: 'Governor usage over time',
          weight: 2,
          content: html`<governor-trends></governor-trends>`,
        },
        {
          // The same id as the selection's tree, deliberately: collapse state is
          // keyed by section id, so the pane treats them as one "Call tree".
          id: 'calltree',
          title: 'Call tree',
          weight: 4,
          content: html`<call-tree-detail .wholeLog=${true}></call-tree-detail>`,
        },
      );
    }
    return sections;
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
