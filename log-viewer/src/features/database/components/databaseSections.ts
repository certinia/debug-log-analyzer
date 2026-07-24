/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { html } from 'lit';

import type { PaneSection } from '../../../components/PaneView.js';
import { computeSoqlIssues } from '../../soql/components/SOQLLinterIssues.js';

// web components
import '../../../components/CallStackDetail.js';
import '../../../components/CallTreeDetail.js';
import '../../soql/components/SOQLLinterIssues.js';
import './DbVitals.js';

export interface DetailSelection {
  eventIndex: number;
  type: 'dml' | 'soql';
}

/**
 * Build the details-panel sections for a selected DML/SOQL statement. The
 * components resolve their own data from `DatabaseAccess` by eventIndex; only
 * the SOQL issue count is pre-resolved here so it can badge the section header.
 */
export async function buildDatabaseSections(selection: DetailSelection): Promise<PaneSection[]> {
  const { eventIndex, type } = selection;

  const sections: PaneSection[] = [
    {
      id: 'vitals',
      title: 'Vitals',
      content: html`<db-vitals eventIndex=${eventIndex} type=${type}></db-vitals>`,
    },
    {
      id: 'callstack',
      title: 'Call stack',
      content: html`<call-stack-detail eventIndex=${eventIndex}></call-stack-detail>`,
    },
    {
      id: 'calltree',
      title: 'Call tree',
      content: html`<call-tree-detail eventIndex=${eventIndex}></call-tree-detail>`,
    },
  ];

  if (type === 'soql') {
    const issues = await computeSoqlIssues(eventIndex);
    sections.push({
      id: 'issues',
      title: 'SOQL issues',
      badge: issues.length ? String(issues.length) : undefined,
      content: html`<soql-issues unbounded .issues=${issues}></soql-issues>`,
    });
  }

  return sections;
}
