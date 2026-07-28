/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { html } from 'lit';

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
}

/**
 * Build the details-panel sections for a selected DML/SOQL statement. The
 * components resolve their own data from `DatabaseAccess` by eventIndex; only
 * the SOQL issue count is pre-resolved here so it can badge the section header.
 */
export async function buildDatabaseSections(
  selection: DetailSelection,
  collapsed: Record<string, boolean> = {},
): Promise<PaneSection[]> {
  const { eventIndex, type } = selection;
  // Persisted collapsed state wins over the per-section default.
  const isCollapsed = (id: string, fallback = false) => collapsed[id] ?? fallback;

  // Each section opens at its own default height (leftover-space share); the
  // call tree gets the most, SOQL issues the least (but still open).
  const sections: PaneSection[] = [
    {
      id: 'vitals',
      title: 'Details',
      weight: 3,
      collapsed: isCollapsed('vitals'),
      content: html`<event-vitals eventIndex=${eventIndex} type=${type}></event-vitals>`,
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
      content: html`<call-tree-detail eventIndex=${eventIndex}></call-tree-detail>`,
    },
  ];

  if (type === 'soql') {
    const issues = await computeSoqlIssues(eventIndex);
    sections.push({
      id: 'issues',
      title: 'SOQL issues',
      weight: 1,
      badge: issues.length ? String(issues.length) : undefined,
      collapsed: isCollapsed('issues'),
      content: html`<soql-issues unbounded .issues=${issues}></soql-issues>`,
    });
  }

  return sections;
}
