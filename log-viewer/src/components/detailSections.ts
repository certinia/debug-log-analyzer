/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, type TemplateResult } from 'lit';

import type { DetailSelection, DetailSource, SelectionView } from '../core/events/EventBus.js';
import { buildDatabaseSections } from '../features/database/components/databaseSections.js';
import type { PaneSection } from './PaneView.js';

// web components
import '../features/analysis/components/LogDiagnosticsView.js';
import '../features/analysis/components/SelfTimeSpreadView.js';
import '../features/database/components/DatabaseOverview.js';
import '../features/database/components/DatabaseTimeTree.js';
import './CallStackDetail.js';
import './CallTreeDetail.js';
import './CategoryTimeBar.js';
import './EventVitals.js';
import './GovernorTrends.js';
import './HotPath.js';
import './HotSpots.js';
import './LogOverview.js';
import './NamespaceTimeBar.js';

/**
 * Build the inspector's sections for a selection from any tab. Every source gets
 * the same shared trio — Details, Call stack, Call tree — scoped to the
 * selection; the Database view keeps its richer set (Vitals + SOQL issues) via
 * {@link buildDatabaseSections}.
 *
 * With nothing selected every source gets the whole-log analogue of what its tab
 * does: the shared **Overview**, plus the sections that tab can answer at log
 * scope. Analysis adds **Findings** and the **Self time spread**; the Database tab adds its whole-log
 * database figures; the Timeline adds its charts and the
 * whole-log call tree; the Call Tree adds the **Hot path** and **Hot spots** —
 * clickable routes into the tree it sits beside.
 *
 * Precedence rule, binding on future scoping inputs such as a timeline time
 * range: an explicit row/frame `selection` always wins. A range or other
 * ambient scope only applies when `selection` is `null`, so it belongs inside
 * the `!selection` branch — never above it.
 *
 * `active` is what the user walked to inside the selection's own call stack:
 * one frame, or the calls a row counts where the view's rows merge occurrences.
 * Details and the call tree follow it; the call stack stays anchored to
 * `selection`, so walking down a stack never puts a frame out of reach.
 */
export async function buildDetailSections(
  source: DetailSource,
  selection: DetailSelection | null,
  active: DetailSelection | null = null,
  sourceView?: SelectionView,
): Promise<PaneSection[]> {
  // Nothing selected: the whole log is the scope. `DetailDock`'s own empty
  // state still covers the moment before a tab id resolves.
  if (!selection) {
    const sections: PaneSection[] = [
      {
        id: 'overview',
        title: 'Overview',
        fit: 'content',
        content: html`<log-overview></log-overview>`,
      },
    ];
    if (source === 'calltree') {
      sections.push(
        {
          id: 'hot-path',
          title: 'Hot path',
          fit: 'content',
          content: html`<hot-path></hot-path>`,
        },
        {
          id: 'hot-spots',
          title: 'Hot spots',
          fit: 'content',
          content: html`<hot-spots></hot-spots>`,
        },
      );
    }
    if (source === 'analysis') {
      sections.push(
        {
          id: 'findings',
          title: 'Findings',
          content: html`<log-diagnostics></log-diagnostics>`,
        },
        // The grid ranks by count and average; the spread gives the shape those
        // averages hide, and how few signatures the log comes down to.
        {
          id: 'self-time-spread',
          title: 'Self time spread',
          fit: 'content',
          content: html`<self-time-spread></self-time-spread>`,
        },
      );
    }
    if (source === 'database') {
      // The Database tab's whole-log analogue: whose code holds the database
      // time, how few statements it comes down to, and which call paths reach it.
      //
      // The Row budget section is written and tested but held back while the tab
      // is judged for length. To re-add it, restore the import of
      // DatabaseRowBudget.js and this section, first in the list:
      //   { id: 'database-rows', title: 'Row budget', fit: 'content',
      //     content: html`<database-rows></database-rows>` },
      sections.push(
        {
          id: 'database-namespaces',
          title: 'Namespace duration',
          fit: 'content',
          content: html`<database-namespaces></database-namespaces>`,
        },
        {
          id: 'database-concentration',
          title: 'Database duration',
          fit: 'content',
          content: html`<database-concentration></database-concentration>`,
        },
        {
          // A grid sized to the pane it is in, so this section takes the space
          // the sized-to-content ones leave.
          id: 'database-time',
          title: 'Call tree',
          weight: 4,
          content: html`<database-time></database-time>`,
        },
      );
    }
    if (source === 'timeline') {
      // The Timeline's whole-log analogue: where the time went (by category and
      // by frame) and how governor consumption built up across the log.
      sections.push(
        {
          id: 'category-time',
          title: 'Time by category',
          fit: 'content',
          content: html`<category-time-bar></category-time-bar>`,
        },
        namespaceTimeSection(html`<namespace-time-bar></namespace-time-bar>`),
        {
          id: 'governor-trends',
          title: 'Governor usage over time',
          fit: 'content',
          content: html`<governor-trends></governor-trends>`,
        },
        {
          // The same id as the selection's tree, deliberately: collapse state is
          // keyed by section id, so the pane treats them as one "Call tree".
          id: 'calltree',
          title: 'Call tree',
          weight: 4,
          // The Timeline draws the whole log top down, so the tree answers with
          // where its time went. Time Order would open on two collapsed roots.
          content: html`<call-tree-detail
            .wholeLog=${true}
            .sourceView=${'callees' as const}
          ></call-tree-detail>`,
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
      activeEventIndex: active?.kind === 'event' ? active.eventIndex : null,
    });
  }

  const isAggregate = selection.kind === 'aggregate';
  // An aggregate scopes to all its occurrences; a single frame to itself.
  const anchorIndex = isAggregate ? (selection.instances[0] ?? -1) : selection.eventIndex;
  // A walked row that merges occurrences answers as its own aggregate, keyed on
  // its first occurrence the way a bucket picked in the tab is.
  const activeIndex =
    active?.kind === 'aggregate'
      ? (active.instances[0] ?? anchorIndex)
      : (active?.eventIndex ?? anchorIndex);
  // The aggregate Details describes, or none once the walk follows one frame
  // inside it: the aggregate no longer describes what is shown.
  const shown =
    active?.kind === 'aggregate'
      ? active
      : isAggregate && activeIndex === anchorIndex
        ? selection
        : null;
  const instances = shown?.instances ?? null;
  const calledBy = shown?.calledBy ?? '';

  const sections: PaneSection[] = [
    {
      id: 'vitals',
      title: 'Details',
      fit: 'content',
      content: html`<event-vitals
        eventIndex=${activeIndex}
        .instances=${instances}
        called-by=${calledBy}
      ></event-vitals>`,
    },
  ];
  if (source === 'timeline') {
    // The same split, asked of the selection: whose package burned the time under
    // the frame the user picked.
    sections.push(
      namespaceTimeSection(
        html`<namespace-time-bar
          eventIndex=${activeIndex}
          .instances=${instances}
        ></namespace-time-bar>`,
      ),
    );
  }
  if (source === 'analysis') {
    // The same findings, asked of the selection: which of the log's problems name
    // this method or anything it called.
    sections.push({
      id: 'findings',
      title: 'Findings',
      // The verdict on the selected row, so it reads beside the tree rather than
      // being crowded down to its header by it.
      weight: 3,
      content: html`<log-diagnostics .instances=${instances ?? [activeIndex]}></log-diagnostics>`,
    });
  }
  sections.push(
    {
      id: 'callstack',
      title: 'Call stack',
      weight: 3,
      content: html`<call-stack-detail
        eventIndex=${anchorIndex}
        activeEventIndex=${activeIndex}
      ></call-stack-detail>`,
    },
    {
      id: 'calltree',
      title: 'Call tree',
      weight: 4,
      content: html`<call-tree-detail
        eventIndex=${anchorIndex}
        .instances=${isAggregate ? selection.instances : null}
        activeEventIndex=${activeIndex}
        .source=${source}
        .sourceView=${sourceView}
      ></call-tree-detail>`,
    },
  );
  return sections;
}

/** The Timeline's namespace split. One id and title for both scopes: collapse
 *  state is keyed by section id, so a drift would split it. */
function namespaceTimeSection(content: TemplateResult): PaneSection {
  return { id: 'namespace-time', title: 'Self time by namespace', fit: 'content', content };
}
