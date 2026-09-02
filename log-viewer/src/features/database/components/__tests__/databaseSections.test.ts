/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// Avoid the heavy component import chains (CalltreeView scss, vscode-elements);
// this suite only exercises the section-assembly logic.
jest.mock('../../../../components/CallStackDetail.js', () => ({}));
jest.mock('../../../../components/CallTreeDetail.js', () => ({}));
jest.mock('../../../../components/EventVitals.js', () => ({}));
jest.mock('../../../soql/components/SOQLLinterIssues.js', () => ({
  computeSoqlIssues: async () => [
    { severity: 'Warning', summary: 'w', message: 'm' },
    { severity: 'Info', summary: 'i', message: 'm' },
  ],
}));

import { render, type TemplateResult } from 'lit';

import type { PaneSection } from '../../../../components/PaneView.js';
import type { CallTreeDetail } from '../../../../components/CallTreeDetail.js';
import { buildDatabaseSections } from '../databaseSections.js';

/**
 * The section content is a template, so it is rendered to read what each
 * component was handed. The components are stubbed above, so nothing upgrades —
 * only the attributes are set.
 */
function rendered(sections: PaneSection[], id: string, tag: string): Element {
  const host = document.createElement('div');
  render(sections.find((s) => s.id === id)?.content as TemplateResult, host);
  const el = host.querySelector(tag);
  if (!el) {
    throw new Error(`${tag} not rendered for section ${id}`);
  }
  return el;
}

describe('buildDatabaseSections', () => {
  it('builds vitals + call stack + issues + call tree for a SOQL selection, badged by count', async () => {
    const sections = await buildDatabaseSections({ eventIndex: 3, type: 'soql' });
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'callstack', 'issues', 'calltree']);
    expect(sections.find((s) => s.id === 'issues')?.badge).toBe('2');
    // The smallest section.
    expect(sections.find((s) => s.id === 'issues')?.weight).toBe(1);
    // The vitals are a fixed set of figures: they take their own height only.
    expect(sections.find((s) => s.id === 'vitals')?.fit).toBe('content');
  });

  it('omits the SOQL issues section for a DML selection', async () => {
    const sections = await buildDatabaseSections({ eventIndex: 5, type: 'dml' });
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'callstack', 'calltree']);
  });

  it('builds vitals + call stack + call tree (no issues) for a SOSL selection', async () => {
    const sections = await buildDatabaseSections({ eventIndex: 7, type: 'sosl' });
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'callstack', 'calltree']);
  });

  it('anchors the call stack and the SOQL issues to the statement the user picked', async () => {
    const sections = await buildDatabaseSections({
      eventIndex: 3,
      type: 'soql',
      activeEventIndex: 1,
    });

    const stack = rendered(sections, 'callstack', 'call-stack-detail');
    expect(stack.getAttribute('eventIndex')).toBe('3');
    expect(stack.getAttribute('activeEventIndex')).toBe('1');
    expect(sections.find((s) => s.id === 'issues')?.badge).toBe('2');
  });

  it('drops the statement shape from the vitals once an ancestor frame is followed', async () => {
    const sections = await buildDatabaseSections({
      eventIndex: 3,
      type: 'soql',
      activeEventIndex: 1,
    });

    const vitals = rendered(sections, 'vitals', 'event-vitals');
    expect(vitals.getAttribute('eventIndex')).toBe('1');
    // An ancestor method is not a statement, so it has no statement type.
    expect(vitals.hasAttribute('type')).toBe(false);
    expect(rendered(sections, 'calltree', 'call-tree-detail').getAttribute('eventIndex')).toBe('1');
  });

  it('names the tab on the call tree, so its view mode is its own', async () => {
    const sections = await buildDatabaseSections({ eventIndex: 3, type: 'soql' });

    const tree = rendered(sections, 'calltree', 'call-tree-detail') as CallTreeDetail;
    expect(tree.source).toBe('database');
  });
});
