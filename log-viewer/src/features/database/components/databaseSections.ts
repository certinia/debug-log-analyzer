/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';

import type { PaneSection } from '../../../components/PaneView.js';
import { computeSoqlIssues } from '../../soql/components/SOQLLinterIssues.js';

// web components
import '../../../components/CallStackDetail.js';
import '../../../components/CallTreeDetail.js';
import '../../../components/EventVitals.js';
import '../../soql/components/SOQLLinterIssues.js';

export interface DetailSelection {
  eventIndex: number;
  type: 'dml' | 'soql' | 'sosl';
  /** The frame walked to in the statement's call stack, if it is not the statement. */
  activeEventIndex?: number | null;
}

/**
 * Build the details-panel sections for a selected DML/SOQL statement. The
 * components resolve their own data from the log store by eventIndex; only
 * the SOQL issue count is pre-resolved here so it can badge the section header.
 *
 * Details and the call tree follow the active frame; the call stack and the SOQL
 * issues stay anchored to the statement the user picked.
 */
export async function buildDatabaseSections(selection: DetailSelection): Promise<PaneSection[]> {
  const { eventIndex, type } = selection;
  const active = selection.activeEventIndex ?? eventIndex;
  // An ancestor method is not a statement, so the statement-shaped vitals do
  // not apply to it.
  const activeType = active === eventIndex ? type : undefined;

  // The vitals are a fixed set of figures, so they take their own height; the
  // fill sections share the leftover space, the call tree getting the most,
  // SOQL issues the least (but still open). The call tree closes the panel.
  const sections: PaneSection[] = [
    {
      id: 'vitals',
      title: 'Details',
      fit: 'content',
      content: html`<event-vitals
        eventIndex=${active}
        type=${ifDefined(activeType)}
      ></event-vitals>`,
    },
    {
      id: 'callstack',
      title: 'Call stack',
      weight: 3,
      content: html`<call-stack-detail
        eventIndex=${eventIndex}
        activeEventIndex=${active}
      ></call-stack-detail>`,
    },
  ];

  if (type === 'soql') {
    const issues = await computeSoqlIssues(eventIndex);
    sections.push({
      id: 'issues',
      title: 'SOQL issues',
      weight: 1,
      badge: issues.length ? String(issues.length) : undefined,
      content: html`<soql-issues unbounded .issues=${issues}></soql-issues>`,
    });
  }

  // Last in every inspector view that has one, so the panel reads the same
  // wherever the selection came from.
  sections.push({
    id: 'calltree',
    title: 'Call tree',
    weight: 4,
    content: html`<call-tree-detail
      eventIndex=${active}
      .source=${'database' as const}
    ></call-tree-detail>`,
  });

  return sections;
}
