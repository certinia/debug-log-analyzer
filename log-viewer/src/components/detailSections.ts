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
import './HotPath.js';
import './HotSpots.js';
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
 * whole-log call tree; the Call Tree adds the **Hot path** and **Hot spots** —
 * clickable routes into the tree it sits beside.
 *
 * Precedence rule, binding on future scoping inputs such as a timeline time
 * range: an explicit row/frame `selection` always wins. A range or other
 * ambient scope only applies when `selection` is `null`, so it belongs inside
 * the `!selection` branch — never above it.
 *
 * `activeEventIndex` is the frame the user walked to inside the selection's own
 * call stack. Details and the call tree follow it; the call stack stays anchored
 * to `selection`, so walking down a stack never puts a frame out of reach.
 */
export async function buildDetailSections(
  source: DetailSource,
  selection: DetailSelection | null,
  activeEventIndex: number | null = null,
): Promise<PaneSection[]> {
  // Nothing selected: the whole log is the scope. `DetailDock`'s own empty
  // state still covers the moment before a tab id resolves.
  if (!selection) {
    const sections: PaneSection[] = [
      {
        id: 'overview',
        title: 'Log overview',
        icon: 'pie-chart',
        fit: 'content',
        content: html`<log-overview></log-overview>`,
      },
    ];
    if (source === 'calltree') {
      sections.push(
        {
          id: 'hot-path',
          title: 'Hot path',
          icon: 'flame',
          fit: 'content',
          content: html`<hot-path></hot-path>`,
        },
        {
          id: 'hot-spots',
          title: 'Hot spots',
          icon: 'dashboard',
          fit: 'content',
          content: html`<hot-spots></hot-spots>`,
        },
      );
    }
    if (source === 'analysis') {
      sections.push({
        id: 'findings',
        title: 'Findings',
        icon: 'checklist',
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
          icon: 'pie-chart',
          fit: 'content',
          content: html`<category-time-bar></category-time-bar>`,
        },
        {
          id: 'governor-trends',
          title: 'Governor usage over time',
          icon: 'graph',
          fit: 'content',
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
    return buildDatabaseSections({
      eventIndex: selection.eventIndex,
      type: selection.type,
      activeEventIndex,
    });
  }

  const isAggregate = selection.kind === 'aggregate';
  // An aggregate scopes to all its occurrences; a single frame to itself.
  const anchorIndex = isAggregate ? (selection.instances[0] ?? -1) : selection.eventIndex;
  const active = activeEventIndex ?? anchorIndex;
  // One frame in the stack is being followed, so the aggregate no longer
  // describes what Details and the call tree are showing.
  const following = active !== anchorIndex;
  const instances = isAggregate && !following ? selection.instances : null;
  const label = isAggregate && !following ? selection.label : '';

  return [
    {
      id: 'vitals',
      title: 'Details',
      fit: 'content',
      content: html`<event-vitals
        eventIndex=${active}
        .instances=${instances}
        label=${label}
      ></event-vitals>`,
    },
    {
      id: 'callstack',
      title: 'Call stack',
      weight: 3,
      content: html`<call-stack-detail
        eventIndex=${anchorIndex}
        activeEventIndex=${active}
      ></call-stack-detail>`,
    },
    {
      id: 'calltree',
      title: 'Call tree',
      weight: 4,
      content: html`<call-tree-detail
        eventIndex=${active}
        .instances=${instances}
      ></call-tree-detail>`,
    },
  ];
}
